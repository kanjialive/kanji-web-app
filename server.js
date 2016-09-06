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

// csv: mongoexport -h ds043220.mongolab.com:43220 -d heroku_app30411812 -c kanji -u heroku_app30411812 -p l4u7h89gdjl80535ompvdvdffj -o export.new.csv --csv -f export_kanji_as_csv.txt
// cli:  mongo ds043220.mongolab.com:43220/heroku_app30411812 -u heroku_app30411812 -p l4u7h89gdjl80535ompvdvdffj

/**
 *
 * @type {string}
 */
var MONGODB_URI = 'mongodb://dayj:eastern-egret-nobility@ds019806.mlab.com:19806/heroku_0c91r1nz';

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
    if (mashape_key === '1lAf0e0Dwe3B8uTF47MVRn8OBbPF6veLDl54ybh6dJgSXKaR9U') { next(); }
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





