/**
 * Created by dayj on 12/13/14.
 */

//db.kanji.find().forEach(
//    function(doc){
//        var pos = positions[doc.rad_name];
//        if (pos != undefined){
//            var components = pos.rad_position.split(',');
//            doc.rad_position_search = components;
//            doc.rad_position = components[components.length -1];
//            doc.rad_position_ja = pos.rad_position_ja;
//            db.kanji.save(doc);
//        }
//    });




//db.kanji.find().forEach(
//   function(doc){
//
//       if (doc.onyomi.length === 0 || doc.kunyomi.length === 0){
//
//           if (doc.onyomi.length === 0){
//                doc.onyomi = 'n/a';
//           }
//           if (doc.kunyomi.length === 0){
//               doc.kunyomi = 'n/a';
//           }
//
//
//           db.kanji.save(doc);
//       }
//
//   });

db.kanji.find().forEach(

  function(doc){

      var noResults = ['々', '央', '械', '穫', '較', '況', '康', '績', '燥', '覧'];
      if (noResults.indexOf(doc['ka_utf']) === -1){
          doc['luminous'] = 'http://www.kenkyusha.co.jp/collab/KanjiAlive/index.php?book=lumi_waei&method=forward&field=' + doc['ka_utf'];
      } else {
          doc['luminous'] = 'n/a';
         print(doc['ka_utf']);
      }
      db.kanji.save(doc);
  }
);

/*
db.kanji.find().forEach(

    function(doc){

        /// meaning search
        doc.meaning_search = array_trim(doc.meaning.split(','));
        doc.meaning_search.push(doc.meaning);
        /// rad meaning search
        doc.rad_meaning_search = array_trim(doc.rad_meaning.split(','));
        doc.rad_meaning_search.push(doc.rad_meaning);

        /// rad name search
        doc.rad_name_search = [doc.rad_name];
        /// rad name ja search
        doc.rad_name_ja_search = [doc.rad_name_ja];

        /// rad position search
        var rad_position_search = doc.rad_position.split(',');
        doc.rad_position_search = array_trim(rad_position_search);
        doc.rad_position_search.push(doc.rad_position);

        /// rad position ja search
        var rad_position_ja_search = doc.rad_position_ja.split(',');
        doc.rad_position_ja_search = array_trim(rad_position_ja_search);
        doc.rad_position_ja_search.push(doc.rad_position_ja);

        doc.kunyomi_ja_search = array_trim(doc.kunyomi_ja.split('、'));
        doc.kunyomi_ja_search.push(doc.kunyomi_ja);
        doc.onyomi_ja_search = array_trim(doc.onyomi_ja.split('、'));
        doc.onyomi_ja_search.push(doc.onyomi_ja);

        doc.kunyomi_search = array_trim(doc.kunyomi.split(','));
        doc.kunyomi_search.push(doc.kunyomi);
        doc.onyomi_search = array_trim(doc.onyomi.split(','));
        doc.onyomi_search.push(doc.onyomi);

        /// fix integer values that were accidentally converted to strings
        doc.grade = parseInt(doc.grade);
        doc.rad_order = parseInt(doc.rad_order);
        doc.rad_stroke = parseInt(doc.rad_stroke);

        db.kanji.save(doc);


    });

    */

// db.kanji.find().forEach(
//   function(doc){
//     if (doc.rad_position != undefined){
//       pring(doc.rad_position);
//     }
//   });

////db.kanji.find.forEach(function (doc) {
////    for (var key in doc) {
////        print(key);
////    }
////});
//
//load('new-textbooks.js');
//
//db.kanji.find().forEach(function (doc) {
//
//    var newTexts  = newTextbooks[doc['ka_utf']];
//    if (newTexts !== undefined){
//        for (var i=0; i < newTexts.length; i++){
//            var text = newTexts[i];
//            doc['txt_books'].push({'txt_bk':text.textbook, 'chapter':text.chapter.toString()});
//        }
//    }
//
//    db.kanji.save(doc);
//
//
//});

//db.kanji.find().forEach(function (doc) {
//
//
//    /**
//     * ⼄ Radical ID#6 > otsu-nine.svg (乾, 九)
//     * ⽕ Radical ID#126 > hi-fire.svg (災,炭,火)
//     *  (i.e. U+E709) Radical ID#127 > hihen-fire.svg (燥,爆,燃,焼,灯,煙)
//     * ⾔ Radical ID#228 > gen-word.svg (警,言)
//     * ⻩ Radical ID#304 > ki-yellow.svg (黄)*
//     */
//
//     var rad_utf = doc['rad_utf'];
//
//    if (rad_utf === '⼄'){
//        print(doc['ka_utf']);
//        doc['rad_name_file'] = 'otsu-nine';
//    } else if (rad_utf === '⽕'){
//        print(doc['ka_utf']);
//        doc['rad_name_file'] = 'hi-fire';
//
//    } else if (rad_utf === ''){
//        print(doc['ka_utf']);
//        doc['rad_name_file'] = 'hihen-fire';
//
//    } else if (rad_utf === '⾔'){
//        print(doc['ka_utf']);
//        doc['rad_name_file'] = 'gen-word';
//
//    } else if (rad_utf === '⻩'){
//        print(doc['ka_utf']);
//        doc['rad_name_file'] = 'ki-yellow';
//
//    } else {
//        doc['rad_name_file'] = doc['rad_name'];
//    }
//
//    db.kanji.save(doc);
//
//
//});



/*
db.kanji.find().forEach(function (doc) {

    var texts = {
        'txtIntermJpn':['ij'],
        'txtMimiFilm':['mos'],
        'txtMajoFilm':['mnt'],
        'txtBasicKanji':['bk'],
        'txtGenki':['gen'],
        'txtAd1':['aij3','aij3:v1'],
        'txtAd2':['aij3','aij3:v2'],
        'txtAd3':['aij3','aij3:v3'],
        'txtAd4':['aij3','aij3:v4'],
        'aij4':['aij4', 'aij4:v1'],
        'txtLookLearn':['kll'],
        'txtIKB':['ik1'],
        'lesson':['cij'],
        'txtAP':['ap'],
        'jt':['jt'],
        'jtr':['jtr'],
        'mosr':['mosr'],
        'mntr':['mntr'],
        'cijr':['cijr'],
        'macquarie':['mac']
    };

    var textbooks = doc['txt_books'];

    var textbook_search = [];

    for (var i = 0; i < textbooks.length; i++){
        var text = textbooks[i];
        var chapter = text['chapter'];
        var book = text['txt_bk'];

        var search_keys = texts[book];
        if (search_keys === undefined){
            // skip these unsupported
            print(book);
        } else {
            for (var j=0; j < search_keys.length; j++){

                var key = search_keys[j];
                textbook_search.push(key);
                textbook_search.push(key + ":" + chapter.toString());
                textbook_search.push(key + ":c" + chapter.toString());

            }
        }
    }

    doc['textbook_search'] = textbook_search;

    db.kanji.save(doc);


});
*/
//
//

Object.deepExtend = function(destination, source) {
    for (var property in source) {
        if (source[property] && source[property].constructor &&
          source[property].constructor === Object) {
            destination[property] = destination[property] || {};
            arguments.callee(destination[property], source[property]);
        } else {
            destination[property] = source[property];
        }
    }
    return destination;
};
//
//load('import_5_2012.js');
//
//for (var i in import_data){
//    var ka = import_data [i];
//    ka.examples = JSON.parse(ka.examples);
//    ka.txt_books = JSON.parse(ka.txt_books);
//    var doc = db.kanji.findOne({'ka_id':ka.ka_id});
//    assert(ka.examples, "Unable to parse examples from csv for ka_id:"+ ka.ka_id);
//    assert(ka.txt_books, "Unable to parse text books from csv for ka_id:"+ ka.ka_id);
//    assert(doc, "Unable to find document for kanji id:" + ka.ka_id);
//
//    Object.deepExtend(doc, ka);
//    db.kanji.save(doc);
//
//}

//db.kanji.find().forEach(function (doc) {
//
//    var newTexts  = newTextbooks[doc['ka_utf']];
//    if (newTexts !== undefined){
//        for (var i=0; i < newTexts.length; i++){
//            var text = newTexts[i];
//            doc['txt_books'].push({'txt_bk':text.textbook, 'chapter':text.chapter.toString()});
//        }
//    }
//
//    db.kanji.save(doc);
//
//
//});


function array_trim(arr){
    var retVal = [];
    for (var i in arr){
        var val = arr[i];
        val = val.trim();
        if (val.length > 0) {
            retVal.push(val);
            var components = val.split(" ");
            if (components.length > 1) {
                for (var j in components) {
                    var valJ = components[j];
                    valJ = valJ.trim();
                    if (valJ.length > 0){
                        retVal.push(valJ);
                    }
                }
            }
        }
    }

    return retVal;

}
