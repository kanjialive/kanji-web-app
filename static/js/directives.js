'use strict';

/* Directives */


angular.module('kanjiAlive.directives', ['duScroll']).
  directive('appVersion', ['version', function(version) {
    return function(scope, elm, attrs) {
      elm.text(version);
    };
  }])
  .directive('backButton', ['$window', function($window) {
        return {
            restrict: 'A',
            link: function (scope, elem, attrs) {
                elem.bind('click', function () {
                    $window.history.back();
                });
            }
        };
  }])
  .directive('kaScrollable', function() {
    return {
      restrict: 'A',
      link: function (scope, elem, attrs) {

        elem = elem[0];

        
        
        scope.$parent.scrollForward = function() {
        	
        	
          var offset = Math.min(elem.scrollWidth, elem.scrollLeft + elem.offsetWidth);
          angular.element(elem).duScrollLeft(offset, 900, duScrollDefaultEasing);
        };

        scope.$parent.scrollBackward = function() {
          var offset = Math.max(0, elem.scrollLeft - elem.offsetWidth);
          angular.element(elem).duScrollLeft(offset, 900, duScrollDefaultEasing);
        };

      }
    };
  })
  .directive('kaAudio', function() {
    return {
      restrict: 'E',
      link: function (scope, elem, attrs) {

        elem = elem[0];
        var audio = elem.children[0];
        var play = elem.children[1];
        play = angular.element(play);
        play.bind('click', function () {
          audio.play();
        });
      }
    };
  })
  .directive('kaGroupScrollable', function() {
        return {
            restrict: 'A',
            link: function (scope, elem, attrs) {

                elem = elem[0];

                /// ...
                scope.groups = elem.children[0].children[0].children[0].children;
                scope.currentGroup = 0;

                scope.$parent.scrollForward = function() {
                    scope.currentGroup = Math.min(scope.groups.length - 1, scope.currentGroup + 1);
                    var targetGroup = scope.groups[scope.currentGroup];
                    var offsetLeft = Math.max(0, targetGroup.offsetLeft + 5);
                    angular.element(elem).duScrollLeft(offsetLeft, 900, duScrollDefaultEasing);
                   
                };

                scope.$parent.scrollBackward = function() {
                    scope.currentGroup = Math.max(0, scope.currentGroup - 1);
                    var targetGroup = scope.groups[scope.currentGroup];
                    var offsetLeft = Math.max(0, targetGroup.offsetLeft + 5);
                  angular.element(elem).duScrollLeft(offsetLeft, 900, duScrollDefaultEasing);
                 
                  
                };

            }
        };
    });