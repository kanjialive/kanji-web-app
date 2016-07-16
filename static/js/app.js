'use strict';


// Declare app level module which depends on filters, and services

angular.module('kanjiAlive', [
  'ngRoute',
  'ui.bootstrap',
  'angular-video',
  'angular-video-controls',
  'cfp.hotkeys',
  'perfect_scrollbar',
  'kanjiAlive.filters',
  'kanjiAlive.services',
  'kanjiAlive.directives',
  'kanjiAlive.controllers'
]).

config(['$routeProvider', '$locationProvider','$sceDelegateProvider',
    function($routeProvider, $locationProvider, $sceDelegateProvider) {

  $routeProvider.when('/search', {templateUrl: 'partials/search.html', controller: 'searchController'});
  $routeProvider.when('/search/advanced', {templateUrl: 'partials/search.html', controller: 'searchController'});
  $routeProvider.when('/search/:search', {templateUrl: 'partials/search.html', controller: 'searchController'});
  $routeProvider.when('/api/docs', {templateUrl: 'partials/docs.html', controller: 'docsController'});
  $routeProvider.when('/:character', {templateUrl: 'partials/detail.html', controller: 'detailController'});

  $routeProvider.otherwise({redirectTo: '/search'});

  $locationProvider.html5Mode(true);

  $sceDelegateProvider.resourceUrlWhitelist([
    // Allow same origin resource loads.
    'self',
    // Allow loading from our assets domain.  Notice the difference between * and **.
    'https://media.kanjialive.com/**']);

}]);

angular.module('kanjiAlive.controllers', []); 

