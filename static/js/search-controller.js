'use strict';

var app = angular.module('kanjiAlive.controllers'); 

app.controller('searchController',
    ['$scope', '$location','$routeParams','$filter','$http','$modal', 'searchService','hotkeys' , function($scope, $location, $routeParams, $filter, $http,$modal, searchService, hotkeys) {


  hotkeys.bindTo($scope)
      .add({
        combo: 'up',
        description: 'Next sort option.',
        callback: function(event, hotkey) {
          $scope.sort(1);
        }
      }).add({
        combo: 'down',
        description: 'Previous sort option.',
        callback: function(event, hotkey) {
          $scope.sort(-1);
        }
      }).add({
        combo: 'left',
        description: 'Previous result group.',
        callback: function(event, hotkey) {
          $scope.scrollBackward();
          event.preventDefault();
        }
      }).add({
        combo: 'right',
        description: 'Next result group.',
        callback: function(event, hotkey) {
          $scope.scrollForward();
          event.preventDefault();
        }
      });

  $scope.setupScope = function() {

    $scope.results = searchService.results;

    $scope.mode = 'kanji';
    $scope.viewState = 0;


    $scope.kanjiStrokeGroups = searchService.kanjiStrokeGroups;
    $scope.radicalStrokeGroups = searchService.radicalStrokeGroups;
    $scope.query = searchService.query;

    var col_width = 38;
    var total_cols = 30;
    var total_rows = 12;
    var min_cols = 7;

    // Calculate the number of columns that would be needed to display these results if all rows were used.
    var cols_needed = Math.ceil($scope.results.length / total_rows);

    // Calculate the actual width taking into account the minimum column count
    var w = Math.max(cols_needed, min_cols) * col_width;

    $scope.kanjiResultsStyle = {'width':w + 'px'};


  };

  /// anytime the search screen is shown reset the detail view mode back to video
  searchService.detailMode = 'video';

  $scope.getKanji = function(endpoint){

    $http.get(endpoint)
        .success(function (data) {

          if (data.hasOwnProperty('error')){
            data = [];
          }

          searchService.results = $filter('orderBy')(data, ['kstroke', 'rad_stroke', 'rad_order']);
          searchService.sortedResults = searchService.results;
          searchService.rSortedResults = $filter('orderBy')(data, ['rad_stroke', 'rad_order', 'kstroke']);
          searchService.kanjiStrokeGroups = searchService.groupByKanjiStrokes(searchService.results);
          searchService.radicalStrokeGroups = searchService.groupByRadicalStrokes(searchService.rSortedResults);

          $scope.setupScope();

        })
        .error(function (error) {
          console.log(error);
        });
    };


  if ($routeParams.search !== undefined){

    $scope.getKanji('/api/search/' + $routeParams.search);
    searchService.query = $routeParams.search;

  }
  else {

    var endpoint = '/api/search/advanced?';
    var params = [];
    for (var key in $routeParams) {

      params.push(key + '=' + $routeParams[key]);

    }

    if (params.length > 0) {

      var query = params.join('&');

      /* In the query language that users type in, keys and values are separated by colons
       * and multiple terms are separated by spaces. In the query language that is passed in
       * the URL the colons are replaced with = and spaces with & to help with compatibility.
       * The server api accepts the raw URL value.
       */

      // Because we are appending to a URI/Route use the raw URI values
      endpoint += query;

      // Because we are pasting into the user visible search box, perform the appropriate
      // transformations from raw to user facing.
      searchService.query = query.replace(/=/g, ':').replace(/&/g, ' ');

      $scope.getKanji(endpoint);

    } else {

      $scope.mode = 'help';

    }
  }

// handle search params


  var modes = ['kanji', 'rsort', 'ksort'];

  $scope.sort = function(i) {

    /// disallow sort when the help screen is shown or
    /// there are no results
    if ($scope.mode === 'help' || $scope.results.length === 0) return;

    $scope.viewState += i;
    $scope.mode = modes[$scope.viewState % 3];

  };

  $scope.setCurrent = function(i){
    searchService.currentIndex = i;
    if ($scope.mode === 'rsort'){
      searchService.sortedResults = searchService.rSortedResults;
    } else {
      searchService.sortedResults = searchService.results;
    }
  }; 

  /* called when hidden submit button is triggered on enter key pressed */
  $scope.search = function() { parseQuery($scope.query); };

  var parseQuery = function(query) {

    searchService.query = query;

    var searchObj = {};
    if (query !== undefined && query.length > 0){
      var components = query.split(':');
      if (components.length >= 2){

        var searchingForKey = true;
        var lastSpaceIndex = - 1;
        var lastColonIndex = -1;
        var key = null;

        for (var i=0; i < query.length; i++){
          if (searchingForKey){
            if (query.charAt(i) === ':'){
              if (lastColonIndex !== -1 && key !== null){
                searchObj[key] = query.substring(lastColonIndex+1, lastSpaceIndex);
              }
              key = query.substring(lastSpaceIndex + 1, i).toLowerCase();;
              searchingForKey = false;
              lastColonIndex = i;

            } else if (query.charAt(i) === ' '){
              lastSpaceIndex = i;
            }
          } else {
            if (query.charAt(i) === ' '){
              lastSpaceIndex = i;
              searchingForKey = true;
            }
          }
        }

        if (lastColonIndex !== -1){
          searchObj[key] = query.substring(lastColonIndex+1);
        }

        $location.path('/search/advanced').search(searchObj);

      } else {

        $location.path('/search/' + query).search({});

      }

      searchService.lastSearch = $location.url();

    }
  };

  $scope.showHelpModal = function (size) {
    $modal.open({
        templateUrl: 'partials/search-help.html',
        controller:'modalController',
        size: size
      });
  };

}]);
