exports.parseAdvancedQuery = function (query) {

  var parsed_query = {};
  var numeric_keys = { 'ks': 'kstroke', 'rs': 'rad_stroke', 'grade': 'grade' };
  var textbook_keys = { 'text': 'textbook_search', 'list': 'textbook_search' };
  var string_keys = { 'kanji': 'ka_utf' };
  var array_keys = { 'kem': 'meaning', 'rem': 'rad_meaning', 'on': 'onyomi', 'kun': 'kunyomi', 'rpos': 'rad_position', 'rjn': 'rad_name' };

  for (var key in numeric_keys) {
    if (query.hasOwnProperty(key)) {
      parsed_query[numeric_keys[key]] = parseInt(query[key]);
    }
  }

  for (var key in string_keys) {
    if (query.hasOwnProperty(key)) {
      parsed_query[string_keys[key]] = query[key];
    }
  }

  for (var key in array_keys) {
    if (query.hasOwnProperty(key)) {

      var array_key = array_keys[key];
      // check if query is japanese

      array_key += (!/[a-zA-Z0-9]/.test(query[key])) ?
        '_ja_search' :
        '_search';

      parsed_query[array_key] = { $in: [query[key]] };

    }
  }

  for (var key in textbook_keys) {
    if (query.hasOwnProperty(key)) {

      var textbook_key = textbook_keys[key];
      var textbook_value = query[key];

      parsed_query[textbook_key] = { $in: [textbook_value] };

    }
  }

  return parsed_query;

};


exports.generateBasicQuery = function (query) {
  return {
    $or: [
      { meaning_search: { $in: [query] } },
      { ka_utf: query },
      { kunyomi_ja_search: { $in: [query] } },
      { onyomi_ja_search: { $in: [query] } }
    ]
  };
};


