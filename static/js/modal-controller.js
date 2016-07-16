/**
 * Created by dayj on 1/9/15.
 */
'use strict';

var app = angular.module('kanjiAlive.controllers');

app.controller(
    'modalController',
    ['$scope', '$modalInstance', function($scope,$modalInstance) {
        $scope.cancel = function () {
            $modalInstance.dismiss('cancel');
        };
    }]);