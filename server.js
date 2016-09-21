/**
 *
 * @type {*|exports}
 */
var express = require('express');

/**
 *
 * @type {exports.Db.connect|exports}
 */
var mongodb = require('mongodb');

/**
 *
 * @type {exports}
 */
var api = require('./server/api');


/**
 *
 */
var app = express();

/**
 *
 * @type {string}
 */
var MONGODB_URI = process.env.MONGOLAB_BLACK_URI;
var MASHAPE_SECRET = process.env.MASHAPE_SECRET;

/**
 *
 */
var db;

/**
 * Initialize mongodb connection once
 */
mongodb.MongoClient.connect(MONGODB_URI, function (err, database) {

    if (err) throw err;

    db = database;
    api.public_api.init(db);
    api.private_api.init(db);

    app.set('port', (process.env.PORT || 5000));

    app.listen(app.get('port'), function () {
        console.log("Node app is running at localhost:" + app.get('port'))
    });

});


/**
 *
 */
app.use(express.static(__dirname));
app.use(express.json());       // to support JSON-encoded bodies
app.use(express.urlencoded()); // to support URL-encoded bodies


/**
 *
 */
app.get('/api/kanji/id/:id', api.private_api.getKanjiWithId);

/**
 *
 */
app.get('/api/kanji/:character', api.private_api.getKanjiWithCharacter);

/**
 *
 */
app.get('/api/search/advanced', api.private_api.advancedSearch);

/**
 *
 */
app.get('/api/search/:search', api.private_api.basicSearch);

/**
 * Verify that public request comes through mashape
 * @param req
 * @param res
 * @param next
 */
var requiresApiKey = function(req, res, next) {
    var mashape_key = req.get('X-Mashape-Proxy-Secret');
    if (mashape_key === MASHAPE_SECRET) { next(); }
    else { res.status(403).end(); }
};


/**
 *
 */
app.get('/api/public/search/advanced', requiresApiKey, api.public_api.advancedSearch);

/**
 *
 */
app.get('/api/public/search/:search', requiresApiKey, api.public_api.basicSearch);

/**
 *
 */
app.get('/api/public/kanji/all', requiresApiKey, api.public_api.getAllKanji);

/**
 *
 */
app.get('/api/public/kanji/:character', requiresApiKey, api.public_api.getKanjiWithCharacter);


/**
 * Redirect to index.html for angular html5 mode
 */
app.all('/*', function (req, res) { res.sendfile('index.html'); });





