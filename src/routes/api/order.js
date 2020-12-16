const Promise = require('bluebird');
const Sequelize = require('sequelize');
const express = require('express');
const moment			= require('moment');
const createError = require('http-errors')
const config = require('config');
const db = require('../../db');
const auth = require('../../middleware/sequelize-authorization-middleware');
const mail = require('../../lib/mail');
const pagination = require('../../middleware/pagination');
const {Op} = require('sequelize');
const { createMollieClient } = require('@mollie/api-client');
const router = express.Router({mergeParams: true});
const generateToken = require('../../util/generate-token');

const fetchOrderMw = function(req, res, next) {

	const orderId = req.params.orderId;

	console.log('fetchOrderMw orderId', orderId);

	let query;

	if (isNaN(orderId)) {
		query = {	where: { hash: orderId } }
	} else {
		query = { where: { id: parseInt(orderId, 10) } }
	}

  req.scope = req.scope ? req.scope : [];

	db.Order
		.scope(...req.scope)
		.findOne(query)
		.then(found => {
			if ( !found ) throw new Error('Order not found');
			req.results = found;
			req.order = found;
			next();
		})
		.catch(next);
}

const calculateOrderTotal = (orderItems, orderFees) => {
	let totals = 0.00;

	orderItems.forEach(item => {
			let price = item.product.price;
			let qty = item.quantity;
			let amount = price * qty;

			totals += amount;
	});

	orderFees.forEach(fee => {
			let price = fee.price;
			let qty = fee.quantity;
			let amount = price * qty;

			totals += amount;
	});

	return totals.toFixed(2);
}

// scopes: for all get requests
/*
router
	.all('*', function(req, res, next) {
		next();
	})
*/

router
	.all('*', function(req, res, next) {
		req.scope = [];
	//	req.scope = ['includeLog', 'includeItems', 'includeTransaction'];
		req.scope.push({method: ['forSiteId', req.params.siteId]});
		next();
	});

router.route('/')

// list users
// ----------
	.get(auth.can('Order', 'list'))
	.get(pagination.init)
	.get(function(req, res, next) {
		let queryConditions = req.queryConditions ? req.queryConditions : {};

		db.Order
			.scope(...req.scope)
		//	.scope()
		//	.findAll()
			.findAndCountAll({
				where:queryConditions,
			 	offset: req.pagination.offset,
			 	limit: req.pagination.limit
			})
			.then(function( result ) {
				req.results = result.rows;
				req.pagination.count = result.count;
				return next();
			})
			.catch(next);
	})
	.get(auth.useReqUser)
//	.get(searchResults)
	.get(pagination.paginateResults)
	.get(function(req, res, next) {
		res.json(req.results);
	})

// create
// -----------
	.post(auth.can('Order', 'create'))
	.post(function(req, res, next) {
		if (!req.site) return next(createError(401, 'Site niet gevonden'));
		return next();
	})
	.post(function( req, res, next ) {
		if (!(req.site.config && req.site.config.order && req.site.config.order.canCreateNewOrders)) return next(createError(401, 'Order mogen niet aangemaakt worden'));
		return next();
	})
	.post(function(req, res, next) {
		const orderSiteConfig = req.site.config && req.site.config.order && req.site.config.order ? req.site.config.order : {};

		req.orderFees = orderSiteConfig && orderSiteConfig.orderFees ? orderSiteConfig.orderFees : [{
			price: '2.95',
			name: 'Verzendkosten',
			quantity: 1
		}];

		next();
	})
	.post(async function( req, res, next) {
		if (req.body.orderItems) {
			const actions = [];
			req.body.orderItems.forEach((orderItem) => {
				actions.push(function() {
					return new Promise(async (resolve, reject) => {
						const product = await db.Product.findOne({ where: { id: orderItem.productId } });
						console.log('productIDDDD', product.id);
						orderItem.product = product;

						resolve();
				 })}())
		 	});

			return Promise.all(actions)
				 .then(() => { next(); })
				 .catch(next)
		} else {
			 next(createError(401, 'No order items send with order request'));
		}
	})
	/*
		Coupons is for later, basic logic is simple,
		buttt, needs some rules, tracking etc.

	.post(async function(req, res, next) {
		const coupon = req.body.coupon ?  await db.OrderCoupon.findOne({ where: { coupon: req.body.coupon, claimed: null } }) : null;

		if (coupon) {
			const amount = coupon.type === 'percentage' ? calculateOrderTotal(req.body.orderItems, req.orderFees) * (coupon.amount / 10) : coupon.amount;

			req.orderFees.push([
				price: amount,
				name: 'Kortingscode',
				quantity: 1
			])
		}

		next();
	})
	*/
	.post(function(req, res, next) {

	 const firstOrderItem = req.body.orderItems[0];
	// console.log('firstOrderItem', firstOrderItem.produ);
	 // derive accountId from the ordered products, which means for now only one order per account per time
	 const accountId = firstOrderItem.product.accountId;

	 console.log('reqbody', req.body)

		const data = {
			accountId: accountId,
			userId: req.user.id,
			email: req.body.email,
			firstName:req.body.firstName,
			lastName: req.body.lastName,
			phoneNumber: req.body.phoneNumber,
			streetName: req.body.streetName,
			houseNumber: req.body.houseNumber,
			postcode: req.body.postcode,
			hash: generateToken({ length: 128 }),
			city: req.body.city,
			suffix: req.body.suffix,
			phoneNumber: req.body.phoneNumber,
			total: calculateOrderTotal(req.body.orderItems, req.orderFees),
			extraData: {
				orderNote: req.body.orderNote,
				test: 'add something'
			}
		}

		console.log('data', data)

		db.Order
			.create(data)
			.then(result => {
				req.results = result;
				next();
			})
			.catch(function( error ) {
				// todo: dit komt uit de oude routes; maak het generieker
				if( typeof error == 'object' && error instanceof Sequelize.ValidationError ) {
					let errors = [];
					error.errors.forEach(function( error ) {
						// notNull kent geen custom messages in deze versie van sequelize; zie https://github.com/sequelize/sequelize/issues/1500
						// TODO: we zitten op een nieuwe versie van seq; vermoedelijk kan dit nu wel
						errors.push(error.type === 'notNull Violation' && error.path === 'location' ? 'Kies een locatie op de kaart' : error.message);
					});
					res.status(422).json(errors);
				} else {
					next(error);
				}
			});

	})
	.post(function(req, res, next) {

		const actions = [];

		req.body.orderItems.forEach((orderItem) => {
			actions.push(function() {
				return new Promise((resolve, reject) => {
					const product = orderItem.product;

					const data = {
						vat: product.vat,
						quantity: orderItem.quantity,
				    orderId: req.results.id,
						productId: product.id,
						price: product.price,
						extraData: {
							product: product
						},
					};

					db.OrderItem
					 .authorizeData(data, 'create', req.user)
					 .create(data)
					 .then((result) => {
						 resolve();
					 })
					 .catch((err) => {
						 console.log('err', err)
						 reject(err);
					 })

			 })}())
		});

		return Promise.all(actions)
			 .then(() => { next(); })
			 .catch(next)
	})
	.post(function(req, res, next) {
		const mollieApiKey = req.site.config && req.site.config.payment && req.site.config.payment.mollieApiKey ? req.site.config.payment.mollieApiKey : '';
		const paymentApiUrl = config.url + '/api/site/'+req.params.siteId+'/order/'+req.results.id +'/payment';
		const mollieClient = createMollieClient({ apiKey: mollieApiKey });

		mollieClient.payments.create({
			amount: {
				value:    req.results.total.toString(),
				currency: 'EUR'
			},
			description: 'Bestelling bij ' + req.site.name,
			redirectUrl: paymentApiUrl,
			webhookUrl:  'https://'+req.site.domain+'/api/site/'+req.params.siteId+'/order/'+req.params.orderId+'/payment-status'
		//	webhookUrl:  paymentApiUrl,
		})
		.then(payment => {
			req.results.extraData  = req.results.extraData ? req.results.extraData : [];
			req.results.extraData.paymentIds = req.results.extraData.paymentIds ? req.results.extraData.paymentIds : [];
			req.results.extraData.paymentIds.push(payment.id);
			req.results.extraData.paymentUrl = payment.getCheckoutUrl();
			req.results
				.save()
				.then(() => { next() })
				.catch(next)
		})
		.catch(err => {
			// Handle the errorz
			next(err);
		});
	})
	.post(function(req, res, next) {
		req.results
			.authorizeData(req.results, 'update', req.user)
			.save()
			.then(result => {
				const orderJson = req.results.get({plain:true});

				const returnValues = {
					...orderJson,
					redirectUrl: req.results.extraData.paymentUrl
				};

				res.json(returnValues);
			})
			.catch(next);
	})

// one user
// --------
router.route('/:orderId')
	.all(fetchOrderMw)

// view idea
// ---------
	.get(auth.can('Order', 'view'))
	.get(auth.useReqUser)
	.get(function(req, res, next) {
		res.json(req.results);
	})

// update user
// -----------
	.put(auth.useReqUser)
	.put(function(req, res, next) {

    const order = req.results;
    if (!( order && order.can && order.can('update') )) return next( new Error('You cannot update this Order') );

    let data = {
      ...req.body,
		}

    order
      .authorizeData(data, 'update')
      .update(data)
      .then(result => {
        req.results = result;
        next()
      })
      .catch(next);
	})
	.put(function(req, res, next) {
		if (req.body.orderItems) {
			req.body.orderItems.forEach((orderItem) => {
				actions.push(function() {
					return new Promise((resolve, reject) => {
					db.OrderItem
					 .authorizeData(data, 'update', req.user)
					 .update(data)
					 .then((result) => {
						 resolve();
					 })
					 .catch((err) => {
						 console.log('err', err)
						 reject(err);
					 })
				 })}())
			});
		}

		return Promise.all(actions)
			 .then(() => { next(); })
			 .catch(next)
	})

// delete idea
// ---------
  .delete(auth.can('Order', 'delete'))
	.delete(function(req, res, next) {
		req.results
			.destroy()
			.then(() => {
				res.json({ "order": "deleted" });
			})
			.catch(next);
	})

router.route('/:orderId(\\d+)/payment')
	.all(fetchOrderMw)
	.all(function(req, res, next) {
		const siteUrl = req.site.config.cms.url + '/thankyou';

		const done = (orderId, orderHash) => {
			return res.redirect(siteUrl + '?resourceId='+ orderId +'&resourceType=order&hash=' + orderHash);
		}



		if (!req.order.extraData && !req.order.extraData.paymentIds  && !req.order.extraData.paymentIds[0]) {
			return next(createError(500, 'No Payment IDs found for this order'));
		}

	/*	if (!req.order.extraData.paymentIds.includes(paymentId)) {
			return next(createError(401, 'Payment ID not for this order'));
		}*/

		const mollieApiKey = req.site.config && req.site.config.payment && req.site.config.payment.mollieApiKey ? req.site.config.payment.mollieApiKey : '';


		const mollieClient = createMollieClient({ apiKey: mollieApiKey });

		const paymentId = req.order.extraData.paymentIds[0];

		console.log('Payment processing paymentId', paymentId, ' orderId: ', req.params.orderId);

		mollieClient.payments.get(paymentId)
		  .then(payment => {

		   	if (payment.isPaid() && req.order.paymentStatus !== 'paid') {
					req.order.set('paymentStatus', 'paid');

					req.order
						.save()
						.then(() => {
							mail.sendThankYouMail(req.order, req.user, req.site) // todo: optional met config?
							done(req.order.id, req.order.hash);
						})
						.catch(next)
				} else {
					done(req.order.id, req.order.hash);
				}
		  })
		  .catch(error => {
					// don't through an error for now
		    	done(req.order.id, req.order.hash);
		  });
	})


module.exports = router;
