/**
 * Created by dayj on 1/6/15.
 */
var groupedRadicals = {};
for (var i = 0; i < unifiedRadicals.length; i++){
    var radical = unifiedRadicals[i];
    if (groupedRadicals[radical.rad_name_ja] !== undefined){
        var radNameGroup = groupedRadicals[radical.rad_name_ja];
        radNameGroup.push(radical);
    } else {
        groupedRadicals[radical.rad_name_ja] = [radical];
    }
}