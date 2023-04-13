const { MongoClient, ServerApiVersion } = require('mongodb');
const path = require('path');

var express = require('express');
var api = require('./server/api');
var app = express();


var MONGODB_URI = process.env.MONGODB_URI;
var MASHAPE_SECRET = process.env.MASHAPE_SECRET;


/**
 * Initialize mongodb connection once
 */
var db;

const client = new MongoClient(MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function connectMongoDB() {
    try {
        await client.connect();
        await client.db("kanjialive").command({ ping: 1 });
        console.log("Successfully connected to MongoDB database for kanjialive!");

        db = client.db('kanjialive');
        api.public_api.init(db);
        api.private_api.init(db);

        app.set('port', (process.env.PORT || 5000));

        app.listen(app.get('port'), function () {
            console.log("Node app is running at localhost:" + app.get('port'))
        });

    } catch (err) {
        console.error(err);
    }
}


app.use(express.static(__dirname));

app.get('/api/kanji/id/:id', api.private_api.getKanjiWithId);
app.get('/api/kanji/:character', api.private_api.getKanjiWithCharacter);
app.get('/api/search/advanced', api.private_api.advancedSearch);
app.get('/api/search/:search', api.private_api.basicSearch);

// Verify that public request comes through mashape
var requiresApiKey = function (req, res, next) {
    var mashape_key = req.get('X-Mashape-Proxy-Secret');
    if (mashape_key === MASHAPE_SECRET) { next(); }
    else { res.status(403).end(); }
};


app.get('/api/public/search/advanced', requiresApiKey, api.public_api.advancedSearch);
app.get('/api/public/search/:search', requiresApiKey, api.public_api.basicSearch);
app.get('/api/public/kanji/all', requiresApiKey, api.public_api.getAllKanji);
app.get('/api/public/kanji/:character', requiresApiKey, api.public_api.getKanjiWithCharacter);

// Redirect to index.html for angular html5 mode
app.all('/*', function (req, res) {
    const options = {
        root: path.join(__dirname)
    };
    res.sendFile('index.html', options);
});

connectMongoDB();
