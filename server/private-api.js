/**
 * Created by dayj on 1/10/15.
 */

/**
 *
 * @type {exports}
 */
var search = require('./search');

/**
 *
 */
var db;

/**
 *
 * @param database
 */
exports.init = function(database){
    db = database;
};

/**
 *
 * @param obj
 * @param req
 * @param res
 */
var getKanjiWithObject = function(obj, req, res){

    db.collection('kanji', function (error, collection) {
        collection.findOne(obj, function (error, result) {
            (error || result == null)
                ? res.send({'Error': 'No kanji found.'})
                : res.send(extendKanjiWithAssets(result));
        });
    });

};

/**
 *
 * @param req
 * @param res
 */
exports.getKanjiWithId = function (req, res) {
    getKanjiWithObject({'ka_id': req.params.id}, req, res);
};

/**
 *
 * @param req
 * @param res
 */
exports.getKanjiWithCharacter =  function (req, res) {
    getKanjiWithObject({'ka_utf': req.params.character}, req, res);
};

/**
 *
 * @param query
 * @param req
 * @param res
 */
var getSearchResultsWithQuery = function(query, req, res){

    if (Object.keys(query).length === 0){
        res.send({'error': 'No kanji found.'});
    } else {

        db.collection('kanji', function (error, collection) {
            collection.find(query, ['ka_id', 'ka_utf', 'kstroke', 'rad_utf', 'rad_stroke', 'rad_order'])
                .toArray(function (error, results) {
                    (error || results == null)
                        ? res.send({'error': 'No kanji found.'})
                        : res.send(results);
                });
        });
    }

};

/**
 *
 * @param req
 * @param res
 */
exports.advancedSearch = function (req, res) {

    var query = (req.query.basic !== undefined) ?
        search.generateBasicQuery(req.query.basic):
        search.parseAdvancedQuery(req.query);

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
 * @param doc
 * @returns {*}
 */
var extendKanjiWithAssets = function (doc){

    var alpha = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z'];
    var examples = [];
    for (var i = 0; i < doc.examples.length; i++){
        var example = {};
        example.japanese = doc.examples[i][0];
        example.english = doc.examples[i][1];
        example.filename = doc.kname + '_06_' + alpha[i];
        example.opus = 'https://media.kanjialive.com/examples_audio/audio-opus/' + example.filename + '.opus';
        example.aac = 'https://media.kanjialive.com/examples_audio/audio-aac/' + example.filename + '.aac';
        example.ogg = 'https://media.kanjialive.com/examples_audio/audio-ogg/' + example.filename + '.ogg';
        example.mp3 = 'https://media.kanjialive.com/examples_audio/audio-mp3/' + example.filename + '.mp3';
        examples.push(example);
    }

    var animation_path = 'https://media.kanjialive.com/kanji_animations/';
    var rad_anim_path = 'https://media.kanjialive.com/rad_frames/';
    var strokes_path= 'https://media.kanjialive.com/kanji_strokes/';
    var typeface_path = 'https://media.kanjialive.com/ka_typefaces/';
    var rad_char_path = 'https://media.kanjialive.com/radical_character/';
    var rad_position_path = 'https://media.kanjialive.com/rad_positions/';
    var id = '000000' + doc.ka_id.split('_')[1];
    var paddedID = id.substr(id.length-4);

    var strokes = [];
    for (var i = 1; i <= doc.kstroke; i++){
        strokes.push(strokes_path + doc.kname + '_' + i + '.svg');
    }

    var hint = doc.mn_hint;
    hint = hint.replace(/\[([0-9]+)\]/g, '<img src="https://media.kanjialive.com/mnemonic_hints/$1.svg" />');

    if (doc.rad_position.length > 0){
      var rad_positions = doc.rad_position.split(',');
      var rad_position_file = rad_positions[rad_positions.length - 1].trim();
      doc['rad_position_file'] = rad_position_path + rad_position_file + '.svg';
    }

    doc['rad_anim_source'] = rad_anim_path + doc.rad_name;
    doc['examples'] = examples;
    doc['strokes'] = strokes;
    doc['poster_video_source'] = strokes_path + doc.kname + '_' + doc.kstroke + '.svg';
    doc['mp4_video_source'] = animation_path + 'kanji_mp4/' + doc.kname + '_00.mp4';
    doc['webm_video_source'] = animation_path + 'kanji_webm/' + doc.kname + '_00.webm';

    doc['kyokasho_source'] = typeface_path + "kyokasho-svg/kyokasho_Page_" + paddedID + '.svg';
    doc['mincho_source'] = typeface_path + "mincho-svg/mincho_Page_" + paddedID + '.svg';
    doc['gothic_source'] = typeface_path + "gothic-svg/gothic_Page_" + paddedID + '.svg';
    doc['maru_source'] = typeface_path + "maru-svg/maru_Page_" + paddedID + '.svg';
    doc['shino_source'] = typeface_path + 'shino-svg/shino_Page_' + paddedID + '.svg';
    doc['tensho_source'] = typeface_path + 'tensho-svg/tensho_Page_' + paddedID + '.svg';
    doc['hiragino_source' ]  = typeface_path + "hiragino-svg/hiragino_Page_" + paddedID + '.svg';
    doc['kanteiryu_source']  = typeface_path + "kanteiryu-svg/kanteiryu_Page_" + paddedID + '.svg';
    doc['suzumushi_source']  = typeface_path + "suzumushi-svg/suzumushi_Page_" + paddedID + '.svg';


    doc['rad_char_source'] = rad_char_path + doc.rad_name_file + '.svg';

    doc['rad_anim_frame_0'] = rad_anim_path + doc.rad_name + '0.svg';
    doc['rad_anim_frame_1'] = rad_anim_path + doc.rad_name + '1.svg';
    doc['rad_anim_frame_2'] = rad_anim_path + doc.rad_name + '2.svg';
    doc['hint'] = hint;

    return doc;

};