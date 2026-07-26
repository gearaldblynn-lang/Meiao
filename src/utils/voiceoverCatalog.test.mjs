import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VOICEOVER_LANGUAGES,
  VOICEOVER_MODEL_MAX_INPUT_TOKENS,
  VOICEOVER_TTS_MODEL,
  VOICEOVER_VOICES,
  getVoiceoverVoice,
  selectAutomaticVoice,
} from './voiceoverCatalog.mjs';

test('catalog pins the current model contract', () => {
  assert.equal(VOICEOVER_TTS_MODEL, 'google/gemini-3-1-flash-tts');
  assert.equal(VOICEOVER_MODEL_MAX_INPUT_TOKENS, 8192);
  assert.equal(VOICEOVER_VOICES.length, 30);
  assert.equal(new Set(VOICEOVER_VOICES.map((voice) => voice.name)).size, 30);
  assert.deepEqual(
    VOICEOVER_LANGUAGES.filter((language) => language.common).map((language) => language.code),
    ['cmn', 'en', 'ja', 'ko', 'es', 'pt', 'fr', 'de', 'ar', 'ru'],
  );
});

test('catalog snapshots preserve the exact ordered 78-language and 30-voice identities', () => {
  assert.deepEqual(
    VOICEOVER_LANGUAGES.map(({ code, englishName, chineseName, common }) => [code, englishName, chineseName, common]),
    [["cmn","Chinese Mandarin","中文（普通话）",true],["en","English","英语",true],["ja","Japanese","日语",true],["ko","Korean","韩语",true],["es","Spanish","西班牙语",true],["pt","Portuguese","葡萄牙语",true],["fr","French","法语",true],["de","German","德语",true],["ar","Arabic","阿拉伯语",true],["ru","Russian","俄语",true],["bn","Bangla","孟加拉语",false],["nl","Dutch","荷兰语",false],["hi","Hindi","印地语",false],["id","Indonesian","印度尼西亚语",false],["it","Italian","意大利语",false],["mr","Marathi","马拉地语",false],["pl","Polish","波兰语",false],["ro","Romanian","罗马尼亚语",false],["ta","Tamil","泰米尔语",false],["te","Telugu","泰卢固语",false],["th","Thai","泰语",false],["tr","Turkish","土耳其语",false],["uk","Ukrainian","乌克兰语",false],["vi","Vietnamese","越南语",false],["af","Afrikaans","南非语",false],["sq","Albanian","阿尔巴尼亚语",false],["am","Amharic","阿姆哈拉语",false],["hy","Armenian","亚美尼亚语",false],["az","Azerbaijani","阿塞拜疆语",false],["eu","Basque","巴斯克语",false],["be","Belarusian","白俄罗斯语",false],["bg","Bulgarian","保加利亚语",false],["my","Burmese","缅甸语",false],["ca","Catalan","加泰罗尼亚语",false],["ceb","Cebuano","宿务语",false],["hr","Croatian","克罗地亚语",false],["cs","Czech","捷克语",false],["da","Danish","丹麦语",false],["et","Estonian","爱沙尼亚语",false],["fil","Filipino","菲律宾语",false],["fi","Finnish","芬兰语",false],["gl","Galician","加利西亚语",false],["ka","Georgian","格鲁吉亚语",false],["el","Greek","希腊语",false],["gu","Gujarati","古吉拉特语",false],["ht","Haitian Creole","海地克里奥尔语",false],["he","Hebrew","希伯来语",false],["hu","Hungarian","匈牙利语",false],["is","Icelandic","冰岛语",false],["jv","Javanese","爪哇语",false],["kn","Kannada","卡纳达语",false],["kok","Konkani","孔卡尼语",false],["lo","Lao","老挝语",false],["la","Latin","拉丁语",false],["lv","Latvian","拉脱维亚语",false],["lt","Lithuanian","立陶宛语",false],["lb","Luxembourgish","卢森堡语",false],["mk","Macedonian","马其顿语",false],["mai","Maithili","迈蒂利语",false],["mg","Malagasy","马达加斯加语",false],["ms","Malay","马来语",false],["ml","Malayalam","马拉雅拉姆语",false],["mn","Mongolian","蒙古语",false],["ne","Nepali","尼泊尔语",false],["nb","Norwegian Bokmål","挪威博克马尔语",false],["nn","Norwegian Nynorsk","挪威尼诺斯克语",false],["or","Odia","奥里亚语",false],["ps","Pashto","普什图语",false],["fa","Persian","波斯语",false],["pa","Punjabi","旁遮普语",false],["sr","Serbian","塞尔维亚语",false],["sd","Sindhi","信德语",false],["si","Sinhala","僧伽罗语",false],["sk","Slovak","斯洛伐克语",false],["sl","Slovenian","斯洛文尼亚语",false],["sw","Swahili","斯瓦希里语",false],["sv","Swedish","瑞典语",false],["ur","Urdu","乌尔都语",false]],
  );
  assert.deepEqual(
    VOICEOVER_VOICES.map(({ name, trait }) => [name, trait]),
    [['Zephyr', 'Bright'], ['Puck', 'Upbeat'], ['Charon', 'Informative'], ['Kore', 'Firm'], ['Fenrir', 'Excitable'], ['Leda', 'Youthful'], ['Orus', 'Firm'], ['Aoede', 'Breezy'], ['Callirrhoe', 'Easy-going'], ['Autonoe', 'Bright'], ['Enceladus', 'Breathy'], ['Iapetus', 'Clear'], ['Umbriel', 'Easy-going'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'], ['Erinome', 'Clear'], ['Algenib', 'Gravelly'], ['Rasalgethi', 'Informative'], ['Laomedeia', 'Upbeat'], ['Achernar', 'Soft'], ['Alnilam', 'Firm'], ['Schedar', 'Even'], ['Gacrux', 'Mature'], ['Pulcherrima', 'Forward'], ['Achird', 'Friendly'], ['Zubenelgenubi', 'Casual'], ['Vindemiatrix', 'Gentle'], ['Sadachbia', 'Lively'], ['Sadaltager', 'Knowledgeable'], ['Sulafat', 'Warm']],
  );
  assert.ok(Object.isFrozen(VOICEOVER_LANGUAGES));
  assert.ok(VOICEOVER_LANGUAGES.every(Object.isFrozen));
  assert.ok(Object.isFrozen(VOICEOVER_VOICES));
  assert.ok(VOICEOVER_VOICES.every((voice) => Object.isFrozen(voice) && Object.isFrozen(voice.tags)));
});

test('automatic voice mapping is deterministic and returns a supported voice', () => {
  const profile = {
    pitch: 'high',
    brightness: 'bright',
    energy: 'energetic',
    pace: 'fast',
    accentDescription: 'clear Mandarin',
  };
  assert.equal(selectAutomaticVoice(profile), selectAutomaticVoice(profile));
  assert.ok(getVoiceoverVoice(selectAutomaticVoice(profile)));
});
