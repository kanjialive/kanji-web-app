/**
 * Created by dayj on 12/13/14.
 */
angular.module('angular-video-controls', [])
  .directive('vgPlayer', function () {
    return {
      restrict: 'A',
      controller: function ($scope) {

        this.setVideo = function (element) {
          $scope.video = element[0];
          angular.element($scope.video).bind('ended', function () {
            $scope.$apply(function () {
              $scope.pause();
            });
          });

        };

        this.play = function () {
          $scope.video.play();
        };
        this.pause = function () {
          $scope.video.pause();
        };
        this.seek = function (time) {
          var start = $scope.video.seekable.start();  // Returns the starting time (in seconds)
          var end = $scope.video.seekable.end();    // Returns the ending time (in seconds)
          $scope.video.currentTime = (time < start) ? start : (time > end) ? end : time;
        }
      }
    };
  })
  .directive('vgVideo', function () {
    return {
      require: '^vgPlayer',
      restrict: 'A',
      link: function (scope, element, attrs, vgPlayer) {
        vgPlayer.setVideo(element);
      }
    };
  })
  .directive('vgPlay', function () {
    return {
      require: '^vgPlayer',
      restrict: 'A',
      link: function (scope, element, attrs, vgPlayer) {
        element.bind('click', function () {
          vgPlayer.play();
        });
      }
    };
  })
  .directive('vgPause', function () {
    return {
      require: '?^vgPlayer',
      restrict: 'A',
      link: function (scope, element, attrs, vgPlayer) {
        element.bind('click', function () {
          vgPlayer.pause();
        });
      }
    };
  })
  .directive('vgSeek', function () {
    return {
      require: '?^vgPlayer',
      restrict: 'A',
      link: function (scope, element, attrs, vgPlayer) {
        element.bind('click', function () {
          vgPlayer.seek(attrs['vg-seek']);
        });
      }
    };
  });