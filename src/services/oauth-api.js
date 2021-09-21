const config = require('config');
const fetch = require('node-fetch');
const merge = require('merge');
const httpBuildQuery = require('../util/httpBuildQuery');
const OAuthUser = require('./oauth-user');

const formatOAuthApiUrl = (path, siteConfig, which = 'default') => {
  let siteOauthConfig = (siteConfig && siteConfig.oauth && siteConfig.oauth[which]) || {};
  let url = siteOauthConfig['auth-server-url'] || config.authorization['auth-server-url'];
  url += path;
  let authClientId = siteOauthConfig['auth-client-id'] || config.authorization['auth-client-id'];
  url = url.replace(/\{\{clientId\}\}/, authClientId);
  url += url.match(/\?/) ? '&' : '?';
  url += `client_id=${authClientId}`;
  return url;
}

const formatOAuthApiCredentials = (siteConfig, which = 'default', token) => {

  // use token
  if (token) return `Bearer ${token}`;

  // use basic auth with clientId/clientSecret
  let siteOauthConfig = (siteConfig && siteConfig.oauth && siteConfig.oauth[which]) || {};
  let authClientId = siteOauthConfig['auth-client-id'] || config.authorization['auth-client-id'];
  let authClientSecret = siteOauthConfig['auth-client-secret'] || config.authorization['auth-client-secret'];
  return 'Basic ' + new Buffer(`${authClientId}:${authClientSecret}`).toString('base64');

}

let OAuthAPI ={};

OAuthAPI.fetchClient = async function({ siteConfig, which = 'default' }) {

  const oauthServerUrl = formatOAuthApiUrl('/api/admin/client/{{clientId}}', siteConfig, which);
  const oauthServerCredentials = formatOAuthApiCredentials(siteConfig, which);

  return fetch(oauthServerUrl, {
	  headers: { "Authorization": oauthServerCredentials, "Content-type": "application/json" },
  })
	  .then((response) => {
		  if (!response.ok) throw Error(response)
		  return response.json();
	  })
	  .catch((err) => {
		  console.log('Niet goed');
		  console.log(err);
	  });

}

OAuthAPI.updateClient = async function({ siteConfig, which = 'default', clientData = {} }) {

  
  let orgClientData = await OAuthAPI.fetchClient({ siteConfig, which });
  let mergedClientData = merge.recursive(true, orgClientData, clientData);

  // for now only the config is updateable from here
  mergedClientData = { config: mergedClientData.config };

  const oauthServerUrl = formatOAuthApiUrl(`/api/admin/client/${orgClientData.id}`, siteConfig, which);
  const oauthServerCredentials = formatOAuthApiCredentials(siteConfig, which);

  return fetch(oauthServerUrl, {
	  headers: { "Authorization": oauthServerCredentials, "Content-type": "application/json" },
    method: 'POST', // TODO: dit is hoe de oauth server nu werkt; dat zou natuurlijk een put of patch moeten worden.
    body: JSON.stringify(mergedClientData),
  })
	  .then((response) => {
		  if (!response.ok) throw Error(response)
		  return response.json();
	  })
	  .then((json) => {
	    return json;
	  })
	  .catch((err) => {
		  console.log('Niet goed');
		  console.log(err);
	  });

}

OAuthAPI.refreshAccessToken = async function({ siteConfig, which = 'default', refreshToken, token}) {

  const siteOauthConfig = (siteConfig && siteConfig.oauth && siteConfig.oauth[which]) || {};
  const authClientId = siteOauthConfig['auth-client-id'] || config.authorization['auth-client-id'];
  const authClientSecret = siteOauthConfig['auth-client-secret'] || config.authorization['auth-client-secret'];
  const authServerExchangeCodePath = siteOauthConfig['auth-server-exchange-code-path'] || config.authorization['auth-server-exchange-code-path'];
  const oauthServerUrl = formatOAuthApiUrl(authServerExchangeCodePath, siteConfig, which);

  let postData = {
    client_id: authClientId,
    client_secret: authClientSecret,
    refresh_token: refreshToken,
    grant_type: 'authorization_code',
    token: token
  }

    // const response = await

  const response = await fetch(oauthServerUrl + authServerExchangeCodePath, {
    headers: { "Authorization": `Bearer ${token}`, "Content-type": "application/json" },
    method: 'POST',
    body: JSON.stringify(postData)
  })

  console.log('regreshshs response', response)

  if (!response.ok) throw Error(response);

  const result =  response.json();

  /*return fetch(oauthServerUrl + authServerExchangeCodePath, {
      headers: { "Authorization": `Bearer ${token}`, "Content-type": "application/json" },
      method: 'POST',
      body: JSON.stringify(postData)
    })
      .then((response) => {
        console.log('regreshshs response', response)

        if (!response.ok) throw Error(response)
        return response.json();
      })
      .then((json) => {
        console.log('regreshshs jsonsons', json)
        let user;
        if (json && json.data && json.data.length > 0) {
          user = json.data[0];
        } else if (json.id) {
          user = json;
        } else if (json.user_id) {
          user = json;
        }


        return user && !raw ? OAuthUser.parseDataForSite(siteConfig, user) : user;
      })
      .catch((err) => {
        console.log('Niet goed refreshshshsh');
        console.log(err);
      })*/

}

OAuthAPI.fetchUser = async function({ siteConfig, which = 'default', email, userId, token, raw = false }) {

  let path = '';
  if ( userId ) path = `/api/admin/user/${userId}`;
  if ( email  ) path = `/api/admin/users?email=${email}`;
  if ( token ) path = `/api/userinfo`;

  if (!path) throw new Error('no Find By arguments found')

  const oauthServerUrl = formatOAuthApiUrl(path, siteConfig, which);
  const oauthServerCredentials = formatOAuthApiCredentials(siteConfig, which, token);

  return fetch(oauthServerUrl, {
	  headers: { "Authorization": oauthServerCredentials, "Content-type": "application/json" },
  })
	  .then((response) => {
      if (!response.ok) throw Error(response)
		  return response.json();
	  })
	  .then((json) => {
      let user;
      if (json && json.data && json.data.length > 0) {
        user = json.data[0];
      } else if (json.id) {
        user = json;
      } else if (json.user_id) {
        user = json;
      }
	    return user && !raw ? OAuthUser.parseDataForSite(siteConfig, user) : user;
	  })
	  .catch((err) => {
		  console.log('Niet goed');
		  console.log(err);
	  });

}

OAuthAPI.createUser = async function({ siteConfig, which = 'default', userData = {} }) {

  const oauthServerUrl = formatOAuthApiUrl('/api/admin/user', siteConfig, which);
  const oauthServerCredentials = formatOAuthApiCredentials(siteConfig, which);

  return fetch(oauthServerUrl, {
	  headers: { "Authorization": oauthServerCredentials, "Content-type": "application/json" },
    method: 'POST',
    body: JSON.stringify(userData),
  })
	  .then((response) => {
		  if (!response.ok) throw Error(response)
		  return response.json();
	  })
	  .catch((err) => {
		  console.log('Niet goed');
		  console.log(err);
	  });

}

OAuthAPI.updateUser = async function({ siteConfig, which = 'default', userData = {} }) {

  // todo: null zou iets moeten leeggooien

  if (!(userData && userData.id)) throw new Error('No user id found')

  let orgUserData = await OAuthAPI.fetchUser({ raw: true, siteConfig, which, userId: userData.id });
  let mergedUserData = OAuthUser.mergeDataForSite(siteConfig, orgUserData, userData);

  const oauthServerUrl = formatOAuthApiUrl(`/api/admin/user/${userData.id}`, siteConfig, which);
  const oauthServerCredentials = formatOAuthApiCredentials(siteConfig, which);

  return fetch(oauthServerUrl, {
	  headers: { "Authorization": oauthServerCredentials, "Content-type": "application/json" },
    method: 'POST', // TODO: dit is hoe de oauth server nu werkt; dat zou natuurlijk een put of patch moeten worden.
    body: JSON.stringify(mergedUserData),
  })
	  .then((response) => {
		  if (!response.ok) throw Error(response)
		  return response.json();
	  })
	  .then((json) => {
      // todo: extraData komt terug als string; los dat op aan de oauth kant
      try {
        json.extraData = JSON.parse(json.extraData);
      } catch (err) {}

      let user;
      if (json.id) {
        user = json;
      }
	    return user;
	  })
	  .catch((err) => {
		  console.log('Niet goed');
		  console.log(err);
	  });

}

OAuthAPI.deleteUser = async function({ siteConfig, which = 'default', userData = {} }) {

  if (!(userData && userData.id)) throw new Error('No user id found')

  const oauthServerUrl = formatOAuthApiUrl(`/api/admin/user/${userData.id}/delete`, siteConfig, which);
  const oauthServerCredentials = formatOAuthApiCredentials(siteConfig, which);

  return fetch(oauthServerUrl, {
	  headers: { "Authorization": oauthServerCredentials, "Content-type": "application/json" },
    method: 'POST', // TODO: dit is hoe de oauth server nu werkt; dat zou natuurlijk een put of patch moeten worden.
    body: JSON.stringify({}),
  })
	  .then((response) => {
		  if (!response.ok) throw Error(response)
		  return response.json();
	  })
	  .catch((err) => {
		  console.log('Niet goed');
		  console.log(err);
	  });

}

module.exports = exports = OAuthAPI;
