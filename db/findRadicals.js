/**
 * Created by dayj on 1/6/15.
 */

load ('groupedRadicals.js');
load('ambiguousRadicals.js');


var failed = [];
var failedNames = {};
var ambiguousNames = {};
var potentiallyResolved = [];
var resolved = [];

var update = function (doc, radical){

    //doc.rad_stroke = parseInt(radical["rad_stroke"]);
    //doc.rad_utf = radical["rad_char"];
    //doc.rad_meaning = radical["rad_meaning"];
    //doc.rad_name_ja = radical["rad_name_ja"];
    //doc.rad_name = radical["rad_name"];
    //doc.rad_position_ja = radical["rad_position_ja"];
    //doc.rad_position = radical["rad_position"];
    //db.kanji.save(doc);

};

db.kanji.find().forEach(
    function(doc){

        if (groupedRadicals[doc.rad_name_ja] === undefined){
            failed.push("No matching rad_name:" + doc.rad_name_ja + ":" + doc.rad_name + ":" + doc.ka_id + ":" + doc.rad_utf + ":" + doc.ka_utf);
            failedNames[doc.rad_name_ja] = "";
        } else {
            var group = groupedRadicals[doc.rad_name_ja];
            if (group.length == 1){
                resolved.push("Match found:" + doc.rad_name_ja + ":" + doc.rad_name + ":" + doc.ka_id + ":" + doc.rad_utf + ":" + doc.ka_utf);
                update(doc, group[0]);
            } else {
                var found = false;
                for (var i = 0; i < group.length; i++){
                    var radical = group[i];
                    if (radical.rad_char === doc.rad_utf){
                        found = true;
                        potentiallyResolved.push("Match found with name and character:" + doc.rad_name_ja + ":" + doc.rad_name + ":" + doc.ka_id + ":" + doc.rad_utf + ":" + doc.ka_utf);
                        update(doc, radical);
                        break;
                    }
                }
                if (!found){
                    var disambiguated = ambiguousRadicals[doc.ka_id];
                    if (disambiguated === undefined){
                        failed.push("Ambiguous rad name without character:" + doc.rad_name_ja + ":" + doc.rad_name + ":" + doc.ka_id + ":" + doc.rad_utf + ":" + doc.ka_utf);
                    } else {
                        var disambiguatedGroup = groupedRadicals[disambiguated['rad_name_ja']];
                        if (disambiguatedGroup === undefined){
                            failed.push("Disambiguated rad_name_ja not found" + doc.rad_name_ja + ":" + doc.rad_name + ":" + doc.ka_id + ":" + doc.rad_utf + ":" + doc.ka_utf);
                        } else {
                            var disambiguatedFound = false;
                            for (var i = 0; i < disambiguatedGroup.length; i++){
                                var disambiguatedRadical = disambiguatedGroup[i];
                                if (disambiguatedRadical.rad_char === disambiguated['rad_char']){
                                    disambiguatedFound = true;
                                    potentiallyResolved.push("Disambiguated match found with name and character:" + doc.rad_name_ja + ":" + doc.rad_name + ":" + doc.ka_id + ":" + doc.rad_utf + ":" + doc.ka_utf);
                                    update(doc, disambiguatedRadical);
                                    break;
                                }
                            }
                            if (!disambiguatedFound){
                                failed.push("Ambiguous disambiguated rad name without character:" + doc.rad_name_ja + ":" + doc.rad_name + ":" + doc.ka_id + ":" + doc.rad_utf + ":" + doc.ka_utf);
                            }
                        }
                    }
                }
            }
        }
    });


