load('ambiguousRadicals.js')

var ids = {};

for (var i =0; i < ambiguousRadicals.length; i++){
	var kanji = ambiguousRadicals[i];
	kanji = kanji.split(',');
	ids[kanji[2]] = {'rad_name_ja':kanji[0], 'rad_char':kanji[5]};
}
//d = {}
//
//for line in f:
//	line = line.strip()
//	c = line.split(':')
//	if len(c) == 6:
//		d[c[2]] = {'rad_name_ja':c[0], 'rad_char':c[5]}
//
//print d
