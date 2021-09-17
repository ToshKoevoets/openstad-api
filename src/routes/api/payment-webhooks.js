/**
 * Logic for webhooks handlig the payment
 */
const Promise = require('bluebird');
const express = require('express');
const db = require('../../db');
const config = require('config');
const rp = require('request-promise');
const crypto = require('crypto');

const auth = require('../../middleware/sequelize-authorization-middleware');
const Sequelize = require('sequelize');
const subscriptionService = require('../../services/subscription');

let router = express.Router({mergeParams: true});


router.route('/mollie/payment')
  .post(async function (req, res) {
    try {

      await db.ActionLog.create({
        actionId: 0,
        log: {
          mollieEvent: true,
          body: req.body,
         // userId: user.id ? user.id : false
        },
        status: 'info'
      });

      const paymentId = req.body.id; //tr_d0b0E3EA3v
    const mollieApiKey = req.site.config && req.site.config.payment && req.site.config.payment.mollieApiKey ? req.site.config.payment.mollieApiKey : '';

    const escapedKey = db.sequelize.escape(`$.paymentId`);
    const escapedValue = db.sequelize.escape(paymentId);
    const query = db.sequelize.literal(`extraData->${escapedKey}=${escapedValue}`);

    const order = await db.Order.findOne({
      [Sequelize.Op.and]: query,
      siteId: req.site.id
    });

    console.log('Webhook order found', order);

    const user = await db.User.findOne({where: {id: order.userId}});

      const result = await mollieService.processPayment(paymentId, mollieApiKey, req.site, order, user, mail, done);
    } catch (e) {
      console.log('Error processing payment: ', e)
      next(e);
    }

    res.send(200);
  });


router.route('/paystack')
  .all(async function (req, res, next) {
    console.log('Paystack webhook start', req.body);



    const paystackApiKey = req.site.config && req.site.config.payment && req.site.config.payment.paystackApiKey ? req.site.config.payment.paystackApiKey : '';
    const hash = crypto.createHmac('sha512', paystackApiKey).update(JSON.stringify(req.body)).digest('hex');

    if (hash === req.headers['x-paystack-signature']) {
      // Retrieve the request's body
      const event = req.body;
      const eventData = event.data ? event.data : {};
      const customerData = eventData && eventData.customer ? eventData.customer : {};
      const customerCode = customerData.customer_code;
      const customerUserCodeKey = paystackApiKey + 'CustomerCode';
      const subscriptionCode = eventData.subscription_code;

      let user, userSubscriptionData;


      if (!customerCode) {
        throw  Error('No customer code received');
      }

      try {
        const escapedKey = db.sequelize.escape(`$.${customerUserCodeKey}`);
        const escapedValue = db.sequelize.escape(customerCode);

        const query = db.sequelize.literal(`siteData->${escapedKey}=${escapedValue}`);
        console.log('query', query)

        user = await db.User.findOne({
          where: {
            [Sequelize.Op.and]: query,
            siteId: req.site.id
          }
        });
      } catch (e) {
        console.warn('Error in fetching a user', e);
        next(e);
      }

      //console.log('user', user);

      try {
        await db.ActionLog.create({
          actionId: 0,
          log: {
            paystackEvent: event,
            userId: user.id ? user.id : false
          },
          status: 'info'
        });
      } catch (e) {
        console.warn('Error in creating log a user', e);
      }

      if (!user) {
        // return 200 for now otherwise keeps firing
        // it can be a bug, but can also be they create a subscription / user that doesnt exist in our database
        return res.send(200);
      }


      console.log('User found with id: ', user.id)

      console.log('Start processing event:', event.event)

      try {
        switch (event.event) {
          case "subscription.create":
            // code block
            console.log('Event subscription.create', event);
            console.log('EventsubscriptionCodee', subscriptionCode);

            await subscriptionService.update({
              user,
              provider: 'paystack',
              subscriptionActive: true,
              subscriptionProductId: '@todo',// req.order.extraData.subscriptionProductId,
              paystackSubscriptionCode: subscriptionCode,
              siteId: req.site.id,
              paystackPlanCode: eventData.paystackPlanCode
            });

            break;
          case "subscription.disable":
            console.log('Event subscription.disable', event);

            userSubscriptionData = user.subscriptionData;

            console.log('EventsubscriptionCodee', subscriptionCode);

            if (!userSubscriptionData && !userSubscriptionData.subscriptions) {
              throw  Error('No subscription data for user with id', user.id, ' for event: ', JSON.stringify(event));
            }

            userSubscriptionData.subscriptions = userSubscriptionData.subscriptions.map((subscription) => {
              if (subscription.paystackSubscriptionCode && subscription.paystackSubscriptionCode === subscriptionCode) {
                subscription.active = false;
              }

              return subscription;
            });

            await user.update({subscriptionData: userSubscriptionData});

            break;

          case "subscription.enable":

            userSubscriptionData = user.subscriptionData;

            if (!userSubscriptionData && !userSubscriptionData.subscriptions) {
              throw  Error('No subscription data for user with id', user.id, ' for event: ', JSON.stringify(event));
            }

            userSubscriptionData.subscriptions = userSubscriptionData.subscriptions.map((subscription) => {
              if (subscription.paystackSubscriptionCode && subscription.paystackSubscriptionCode === subscriptionCode) {
                subscription.active = true;
              }

              return subscription;
            });

            await user.update({subscriptionData: userSubscriptionData});

            break;

          /*
        case "paymentrequest.success":

          const user = await db.User.findOne({where: {id: req.order.userId}});

          await subscriptionService.update({
            user,
            provider: 'paystack',
            subscriptionActive : true,
            subscriptionProductId: req.order.extraData.subscriptionProductId,
            siteId: req.site.id,
            paystackPlanCode:  req.order.extraData.paystackPlanCode
          });

          break;

           */
          default:
          // code block
        }
      } catch (e) {
        console.log('Erorororor: ', e);
        next(e);
      }
    }
    res.send(200);
  });


router.route('/stripe')
  .post(function (req, res, next) {
    /**
     * @TODO
     */

  });

module.exports = router;
