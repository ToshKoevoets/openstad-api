var config       = require('config');
var pmx          = require('pmx');
var jwt          = require('jsonwebtoken');
const createError = require('http-errors');
const merge = require('merge');

var db           = require('../db');

var uidProperty  = config.get('security.sessions.uidProperty');
var cookieTTL    = config.get('security.sessions.cookieTTL');

db.User.findOne({where: {id: 1, role: 'unknown'}}).then(function( unknownUser ) {
	if( !unknownUser ) {
		console.error('User ID 1 must have role \'unknown\'');
		process.exit();
	}
});

module.exports = function getSessionUser( req, res, next ) {

	req.setSessionUser   = setSessionUser.bind(req);
	req.unsetSessionUser = unsetSessionUser.bind(req);
	
	if( !req.session ) {
		return next(Error('express-session middleware not loaded?'));
	}

	let userId = req.session[uidProperty];

	if (req.headers['x-authorization']) {

		// jwt overrules other settings
		if (req.headers['x-authorization'].match(/^bearer /i)) {
			// jwt overrules other settings
			let token = req.headers['x-authorization'].replace(/^bearer /i, '');
			let data = jwt.verify(token, config.authorization['jwt-secret'])
			if (data && data.userId) {
				userId = data.userId
			}
		}

		// auth token overrules other settings
		let tokens = config && config.authorization && config.authorization['fixed-auth-tokens'];
		if (tokens) {
			tokens.forEach((token) => {
				if ( token.token == req.headers['x-authorization'] ) {
					userId = token.userId;
				}
			});
		}

	}
	
	getUserInstance(userId || 1, req.site)
		.then(function( user ) {
			req.user = user;
			// Pass user entity to template view.
			res.locals.user = user;
			next();
		})
		.catch(next);

}

function setSessionUser( userId, originUrl ) {
	// The original `maxAge` is 'session', but now the user wants to
	// stay logged in.
	this.session.cookie.maxAge = cookieTTL;
	this.session[uidProperty] = userId;
	if( originUrl ) {
		this.session['ref'] = originUrl;
	}
}

function unsetSessionUser() {
	this.session.cookie.maxAge = null;
	this.session[uidProperty]  = null;
	this.session['ref']        = null;
}

function getUserInstance( userId, site ) {

	return db.User.findByPk(userId)
		.then(function( dbuser ) {
			if( !dbuser ) {
				return db.User.findByPk(1);
			}
			return dbuser;
		})
		.then(function( dbuser ) {

			let user = dbuser;

			// fetch user data from mijnopenstad
			if (dbuser && dbuser.externalUserId && dbuser.externalAccessToken) {

				// get the user info using the access token
				let authServerUrl = ( site && site.config.oauth['auth-server-url'] ) || config.authorization['auth-server-url'];
				let authServerGetUserPath = ( site && site.config.oauth['auth-server-get-user-path'] ) || config.authorization['auth-server-get-user-path'];
				let authClientId = ( site && site.config.oauth['auth-client-id'] ) || config.authorization['auth-client-id'];
				let url = authServerUrl + authServerGetUserPath;
				url = url.replace(/\[\[clientId\]\]/, authClientId);

				return fetch(
					url, {
						method: 'get',
						headers: {
							authorization : 'Bearer ' + dbuser.externalAccessToken,
						},
						mode: 'cors',
					})
					.then(
						response => {
							if ( !response.ok ) {
								throw new Error('Error fetching user')
							};
							return response.json();
						},
						error => { throw createError(403, 'User niet bekend') }
					)
					.then(
						json => {
							json.role = json.role || 'member';
							user = merge(dbuser, json)
							return user;
						}
					)

			} else {
				return user;
			}

		})
		.then(function( user ) {
			return user;
		})
}

