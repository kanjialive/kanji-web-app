/**
 * Created by dayj on 1/11/15.
 */

load('new-textbooks.js');

var groupedTextbooks = {};

for (var i = 0; i < newTextbooks.length; i++){
    var components = newTextbooks[i].split(',');
    var kanji = components[0];
    if (groupedTextbooks[kanji] === undefined){
        groupedTextbooks[kanji] = [{'textbook':components[1], 'chapter':parseInt(components[2])}];
    } else {
        groupedTextbooks[kanji].push({'textbook':components[1], 'chapter':parseInt(components[2])});
    }
}


