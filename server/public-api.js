/**
 * Created by dayj on 1/10/15.
 */

/**
 *
 * @type {exports}
 */
var search = require('./search');
var db;

exports.init = function (database) {
    db = database;
};


/**
 *
 * @param query
 * @param req
 * @param res
 */
var getSearchResultsWithQuery = function(query, req, res){

    db.collection('kanji', function (error, collection) {
        collection.find(query, ['ka_id', 'ka_utf', 'kstroke', 'rad_utf', 'rad_stroke', 'rad_order'])
            .toArray(function (error, results) {
                if (error || results == null) {
                    res.send({'error': 'No kanji found.'});
                } else {
                    var structured_results = [];
                    for (var i=0; i < results.length; i++){
                        var doc = results[i];
                        structured_results.push({
                            'kanji': {
                                //'id':doc['ka_id'],
                                'character':doc['ka_utf'],
                                'stroke':doc['kstroke']
                            },
                            'radical': {
                                'character':doc['rad_utf'],
                                'stroke':doc['rad_stroke'],
                                'order':doc['rad_order']
                            }
                        })
                    }
                    res.send(structured_results);
                }
            });
    });

};

/**
 *
 * @param req
 * @param res
 */
exports.advancedSearch = function (req, res) {
    var query = search.parseAdvancedQuery(req.query);
    getSearchResultsWithQuery(query, req, res);
};

/**
 *
 * @param req
 * @param res
 */
exports.basicSearch =  function (req, res) {
    var query = search.generateBasicQuery(req.params.search);
    getSearchResultsWithQuery(query, req, res);
};

/**
 *
 */
exports.getKanjiWithCharacter = function (req, res) {

    db.collection('kanji', function (error, collection) {
        collection.findOne({'ka_utf': req.params.character}, function (error, result) {
            (error || result == null)
                ? res.send({'error': 'No kanji found.'})
                : res.send(extendKanjiWithAssets(result));
        });
    });
};

exports.getAllKanji = function(req, res) {
    db.collection('kanji', function (error, collection) {
        collection.find({}).toArray(function (error, results) {
            if (error || results == null) {
                res.send({'error': 'No kanji found.'});
            } else {
                var structured_results = [];
                for (var i = 0; i < results.length; i++) {
                    var doc = results[i];
                    structured_results.push(extendKanjiWithAssets(doc));
                }
                res.send(structured_results);
            }
        });
    });
};

/**
 *
 * @param doc
 * @returns {*}
 */
var extendKanjiWithAssets = function (doc){

    var animation_path = 'https://media.kanjialive.com/kanji_animations/';
    var rad_anim_path = 'https://media.kanjialive.com/rad_frames/';
    var strokes_path= 'https://media.kanjialive.com/kanji_strokes/';
    var typeface_path = 'https://media.kanjialive.com/ka_typefaces/';
    var rad_char_path = 'https://media.kanjialive.com/radical_character/';
    var examples_path = 'https://media.kanjialive.com/examples_audio/';
    var rad_position_path = 'https://media.kanjialive.com/rad_positions/';

    var id = '000000' + doc.ka_id.split('_')[1];
    var paddedID = id.substr(id.length-4);

    /// setup kanji
    var kanji = {};
    kanji.character = doc.ka_utf;

    kanji.meaning= {
      'english' : doc.meaning
    };

    var stroke_images = [];

    for (var i = 1; i <= doc.kstroke; i++){
        stroke_images.push(strokes_path + doc.kname + '_' + i + '.svg');
    }

    kanji.strokes = {
        'count': doc.kstroke,
        'timings': doc.stroketimes,
        'images' : stroke_images
    };

    kanji.onyomi = {
        'romaji':doc.onyomi,
        'katakana':doc.onyomi_ja
    };

    kanji.kunyomi = {
        'romaji':doc.kunyomi,
        'hiragana':doc.kunyomi_ja
    };

    kanji.video = {
        'poster': strokes_path + doc.kname + '_' + doc.kstroke + '.svg',
        'mp4': animation_path + 'kanji_mp4/' + doc.kname + '_00.mp4',
        'webm':animation_path + 'kanji_webm/' + doc.kname + '_00.webm'
    };

    //kanji['typefaces'] = {
    //    'kyokasho'  :typeface_path + "kyokasho-svg/kyokasho_Page_" + paddedID + '.svg',
    //    'mincho'    :typeface_path + "mincho-svg/mincho_Page_" + paddedID + '.svg',
    //    'gothic'    :typeface_path + "gothic-svg/gothic_Page_" + paddedID + '.svg',
    //    'maru'      :typeface_path + "maru-svg/maru_Page_" + paddedID + '.svg',
    //    'tensho'    :typeface_path + 'tensho-svg/tensho_Page_' + paddedID + '.svg',
    //    'gyosho'  :typeface_path + "hiragino-svg/hiragino_Page_" + paddedID + '.svg',
    //    'kanteiryu'  :typeface_path + "kanteiryu-svg/kanteiryu_Page_" + paddedID + '.svg',
    //    'contemporary'  :typeface_path + "suzumushi-svg/suzumushi_Page_" + paddedID + '.svg'
    //};

    /// setup radical
    var rad_position_file = "";
    if (doc.rad_position.length > 0){
        var rad_positions = doc.rad_position.split(',');
        rad_position_file = rad_positions[rad_positions.length - 1].trim();
        rad_position_file = rad_position_path + rad_position_file + '.svg';
    }

    var radical = {
        'character':doc.rad_utf,
        'strokes':doc.rad_stroke,
        'image':rad_char_path + doc.rad_name_file + '.svg',
        'position': {
            'hiragana':doc.rad_position_ja,
            'romaji':doc.rad_position,
            'icon':rad_position_file
        },
        'name': {
            'hiragana':doc.rad_name_ja,
            'romaji':doc.rad_name
        },
        'meaning': {
            'english': doc.rad_meaning
        },
        'animation': [
            rad_anim_path + doc.rad_name + '0.svg',
            rad_anim_path + doc.rad_name + '1.svg',
            rad_anim_path + doc.rad_name + '2.svg'
        ]
    };

    /// setup references
    var references = {
        'grade':doc.grade,
        'kodansha':doc.dick,
        'classic_nelson':doc.dicn
    };

    /// setup examples
    var alpha = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z'];
    var examples = [];

    for (var i = 0; i < doc.examples.length; i++){
        var example = {
            'japanese':doc.examples[i][0],
            'meaning': { 'english' : doc.examples[i][1] },
            'audio': {
                'opus': examples_path + 'audio-opus/' + doc.kname + '_06_' + alpha[i] + '.opus',
                'aac':  examples_path + 'audio-aac/' + doc.kname + '_06_' + alpha[i] + '.aac',
                'ogg':  examples_path + 'audio-ogg/' + doc.kname + '_06_' + alpha[i] + '.ogg',
                'mp3':  examples_path + 'audio-mp3/' + doc.kname + '_06_' + alpha[i] + '.mp3'
            }
        };
        examples.push(example);
    }

    return {
        'kanji':kanji,
        'radical':radical,
        'references':references,
        'examples':examples
    };

};


