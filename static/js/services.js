'use strict';

angular.module('kanjiAlive.services', []).value('version', '0.1');

var services = angular.module('kanjiAlive.services');

services.factory('searchService', ['$http', '$filter', function($http, $filter) {


  var api = {};

  api.groupByRadicalStrokes = function(data) {
    api.resultsGroupedByRadical =  groupByStrokeAndRadical(data, 'rad_stroke');
    return api.resultsGroupedByRadical;
  };

  api.groupByKanjiStrokes = function(data) {
    // already kanji sorted
    api.resultsGroupedByKanji = groupByStrokeAndRadical(data, 'kstroke');
    return api.resultsGroupedByKanji;
  };

  api.detailMode = 'video';
  api.currentTypeface = 4;


  var groupByStrokeAndRadical = function(data, strokeKey){
    var currentGroup = {};
    var groups = [];
    var rowCount = 1;
    var previousRadical = undefined;
    var index = 0;
    for (var i in data) {
      var kanji = data[i];
      kanji.sortedIndex = index;
      index++;
      // if we are still in the same stroke group
      if (kanji[strokeKey] === currentGroup.stroke){
        // we can assume that currentGroup.columns has already been created
        // check if radical character is the same as the previous radical character
        if (previousRadical.radical === kanji.rad_utf){
          // radical has already been added to column, so try to add to last row
          var lastRow = previousRadical.rows[previousRadical.rows.length - 1];
          // if so add kanji to the radical's rows
          if (lastRow.length < 6) lastRow.push(kanji);
          else {
            // last row was full, try to create new row
            // if new row is needed check total row count for column
            if (rowCount < 10) {
              previousRadical.rows.push([kanji]);
              rowCount++;
            }
            else {
              // we need to move to another column
              previousRadical = {
                'radical':kanji.rad_utf,
                'rows': [[kanji]]
              };
              currentGroup.columns.push([previousRadical]);
              // reset row count
              rowCount = 1;
            }
          }
        }
        else {
          // otherwise if the radical character is not the same, create a new radical, and start
          // a new row within that radical
          previousRadical = {
            'radical':kanji.rad_utf,
            'rows': [[kanji]]
          };
          if (rowCount < 10) {
            var lastColumn = currentGroup.columns[currentGroup.columns.length - 1];
            lastColumn.push(previousRadical);
            rowCount++;
          }
          else {
            // we need to move to another column
            currentGroup.columns.push([previousRadical]);
            // reset row count
            rowCount = 1;
          }

        }

      } else {
        currentGroup = {
          'stroke':kanji[strokeKey],
          'columns':[[
            {
              'radical': kanji.rad_utf,
              'rows': [[kanji]]
            }
          ]]
        };
        groups.push(currentGroup);
        // reset rowCount
        rowCount = 1;
        // set previousRadical
        previousRadical = currentGroup.columns[0][0];
      }
    }

    return groups;

  };


  return api;

 // This is the desired outcome
 //{
 //  'columns' : [
 //  [{
 //    'radical':'char',
 //    'rows': [
 //      ['kanji','kanji','kanji','kanji','kanji'],
 //      ['kanji','kanji','kanji','kanji','kanji']
 //    ]
 //  }]
 // ]
 //}

}]);

