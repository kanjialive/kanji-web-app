angular.module("angular-video", []).directive("vgSrc",
    function () {
        return {
            restrict: "A",
            link: {
                pre: function (scope, elem, attr) {
                    var element = elem;
                    var sources;
                    var canPlay;

                    function changeSource() {
                        for (var i = 0, l = sources.length; i < l; i++) {
                            canPlay = element[0].canPlayType(sources[i].type);

                            if (canPlay == "maybe" || canPlay == "probably") {
                                element.attr("src", sources[i].src);
                                element.attr("type", sources[i].type);
                                break;
                            }
                        }

                        if (canPlay == "") {
                            scope.$emit("onVideoError", {type: "Can't play file"})
                        }
                    }

                    scope.$watch(attr.vgSrc, function (newValue, oldValue) {
                        if (!sources || newValue != oldValue) {
                            sources = newValue;
                            changeSource();
                        }
                    });
                }
            }
        }
    }
);

