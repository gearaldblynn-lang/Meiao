export const VOICEOVER_TTS_MODEL = 'google/gemini-3-1-flash-tts';
export const VOICEOVER_MODEL_MAX_INPUT_TOKENS = 8192;

const freezeEntries = (entries) => Object.freeze(entries.map((entry) => Object.freeze(entry)));

export const VOICEOVER_LANGUAGES = freezeEntries([
  ['cmn', 'Chinese Mandarin', '中文（普通话）', true], ['en', 'English', '英语', true],
  ['ja', 'Japanese', '日语', true], ['ko', 'Korean', '韩语', true], ['es', 'Spanish', '西班牙语', true],
  ['pt', 'Portuguese', '葡萄牙语', true], ['fr', 'French', '法语', true], ['de', 'German', '德语', true],
  ['ar', 'Arabic', '阿拉伯语', true], ['ru', 'Russian', '俄语', true], ['bn', 'Bangla', '孟加拉语'],
  ['nl', 'Dutch', '荷兰语'], ['hi', 'Hindi', '印地语'], ['id', 'Indonesian', '印度尼西亚语'],
  ['it', 'Italian', '意大利语'], ['mr', 'Marathi', '马拉地语'], ['pl', 'Polish', '波兰语'],
  ['ro', 'Romanian', '罗马尼亚语'], ['ta', 'Tamil', '泰米尔语'], ['te', 'Telugu', '泰卢固语'],
  ['th', 'Thai', '泰语'], ['tr', 'Turkish', '土耳其语'], ['uk', 'Ukrainian', '乌克兰语'],
  ['vi', 'Vietnamese', '越南语'], ['af', 'Afrikaans', '南非语'], ['sq', 'Albanian', '阿尔巴尼亚语'],
  ['am', 'Amharic', '阿姆哈拉语'], ['hy', 'Armenian', '亚美尼亚语'], ['az', 'Azerbaijani', '阿塞拜疆语'],
  ['eu', 'Basque', '巴斯克语'], ['be', 'Belarusian', '白俄罗斯语'], ['bg', 'Bulgarian', '保加利亚语'],
  ['my', 'Burmese', '缅甸语'], ['ca', 'Catalan', '加泰罗尼亚语'], ['ceb', 'Cebuano', '宿务语'],
  ['hr', 'Croatian', '克罗地亚语'], ['cs', 'Czech', '捷克语'], ['da', 'Danish', '丹麦语'],
  ['et', 'Estonian', '爱沙尼亚语'], ['fil', 'Filipino', '菲律宾语'], ['fi', 'Finnish', '芬兰语'],
  ['gl', 'Galician', '加利西亚语'], ['ka', 'Georgian', '格鲁吉亚语'], ['el', 'Greek', '希腊语'],
  ['gu', 'Gujarati', '古吉拉特语'], ['ht', 'Haitian Creole', '海地克里奥尔语'], ['he', 'Hebrew', '希伯来语'],
  ['hu', 'Hungarian', '匈牙利语'], ['is', 'Icelandic', '冰岛语'], ['jv', 'Javanese', '爪哇语'],
  ['kn', 'Kannada', '卡纳达语'], ['kok', 'Konkani', '孔卡尼语'], ['lo', 'Lao', '老挝语'],
  ['la', 'Latin', '拉丁语'], ['lv', 'Latvian', '拉脱维亚语'], ['lt', 'Lithuanian', '立陶宛语'],
  ['lb', 'Luxembourgish', '卢森堡语'], ['mk', 'Macedonian', '马其顿语'], ['mai', 'Maithili', '迈蒂利语'],
  ['mg', 'Malagasy', '马达加斯加语'], ['ms', 'Malay', '马来语'], ['ml', 'Malayalam', '马拉雅拉姆语'],
  ['mn', 'Mongolian', '蒙古语'], ['ne', 'Nepali', '尼泊尔语'], ['nb', 'Norwegian Bokmål', '挪威博克马尔语'],
  ['nn', 'Norwegian Nynorsk', '挪威尼诺斯克语'], ['or', 'Odia', '奥里亚语'], ['ps', 'Pashto', '普什图语'],
  ['fa', 'Persian', '波斯语'], ['pa', 'Punjabi', '旁遮普语'], ['sr', 'Serbian', '塞尔维亚语'],
  ['sd', 'Sindhi', '信德语'], ['si', 'Sinhala', '僧伽罗语'], ['sk', 'Slovak', '斯洛伐克语'],
  ['sl', 'Slovenian', '斯洛文尼亚语'], ['sw', 'Swahili', '斯瓦希里语'], ['sv', 'Swedish', '瑞典语'],
  ['ur', 'Urdu', '乌尔都语'],
].map(([code, englishName, chineseName, common = false]) => ({ code, englishName, chineseName, common })));

const VOICE_ENTRIES = [
  ['Zephyr', 'Bright'], ['Puck', 'Upbeat'], ['Charon', 'Informative'], ['Kore', 'Firm'], ['Fenrir', 'Excitable'],
  ['Leda', 'Youthful'], ['Orus', 'Firm'], ['Aoede', 'Breezy'], ['Callirrhoe', 'Easy-going'], ['Autonoe', 'Bright'],
  ['Enceladus', 'Breathy'], ['Iapetus', 'Clear'], ['Umbriel', 'Easy-going'], ['Algieba', 'Smooth'], ['Despina', 'Smooth'],
  ['Erinome', 'Clear'], ['Algenib', 'Gravelly'], ['Rasalgethi', 'Informative'], ['Laomedeia', 'Upbeat'], ['Achernar', 'Soft'],
  ['Alnilam', 'Firm'], ['Schedar', 'Even'], ['Gacrux', 'Mature'], ['Pulcherrima', 'Forward'], ['Achird', 'Friendly'],
  ['Zubenelgenubi', 'Casual'], ['Vindemiatrix', 'Gentle'], ['Sadachbia', 'Lively'], ['Sadaltager', 'Knowledgeable'], ['Sulafat', 'Warm'],
];

const TRAIT_TAGS = Object.freeze({
  Bright: [2, 3, 2, 2], Upbeat: [2, 2, 3, 3], Informative: [2, 2, 2, 2], Firm: [1, 1, 2, 2],
  Excitable: [3, 3, 3, 3], Youthful: [3, 3, 3, 3], Breezy: [3, 3, 2, 3], 'Easy-going': [2, 2, 1, 2],
  Breathy: [2, 1, 1, 1], Clear: [2, 3, 2, 2], Smooth: [2, 2, 1, 2], Gravelly: [1, 1, 2, 1],
  Soft: [2, 1, 1, 1], Even: [2, 2, 2, 2], Mature: [1, 1, 1, 1], Forward: [2, 3, 3, 2],
  Friendly: [2, 2, 2, 2], Casual: [2, 2, 2, 2], Gentle: [2, 1, 1, 1], Lively: [2, 3, 3, 3],
  Knowledgeable: [2, 2, 2, 2], Warm: [2, 1, 2, 2],
});

const KEYWORD_TRAITS = Object.freeze({ clear: 'Clear', soft: 'Soft', warm: 'Warm', bright: 'Bright', casual: 'Casual', firm: 'Firm' });

export const VOICEOVER_VOICES = freezeEntries(VOICE_ENTRIES.map(([name, trait]) => ({
  name,
  trait,
  tags: Object.freeze(TRAIT_TAGS[trait]),
})));

export const getVoiceoverLanguage = (code) => VOICEOVER_LANGUAGES.find((entry) => entry.code === String(code || '').trim()) || null;
export const getVoiceoverVoice = (name) => VOICEOVER_VOICES.find((entry) => entry.name === String(name || '').trim()) || null;
export const listVoiceoverLanguages = () => VOICEOVER_LANGUAGES.slice();

const PROFILE_TAGS = Object.freeze({
  pitch: Object.freeze({ low: 1, medium: 2, high: 3 }),
  brightness: Object.freeze({ dark: 1, balanced: 2, bright: 3 }),
  energy: Object.freeze({ calm: 1, balanced: 2, energetic: 3 }),
  pace: Object.freeze({ slow: 1, natural: 2, fast: 3 }),
});

const normalizedAccentKeywords = (value) => String(value || '').toLowerCase().match(/[a-z]+/gu) || [];

export function selectAutomaticVoice(profile = {}) {
  const profileTags = ['pitch', 'brightness', 'energy', 'pace'].map((key) => PROFILE_TAGS[key][profile?.[key]] || 0);
  const scored = VOICEOVER_VOICES.map((voice) => ({
    voice,
    score: voice.tags.reduce((score, tag, index) => score + Number(tag === profileTags[index] && tag !== 0), 0),
  }));
  const topScore = Math.max(...scored.map(({ score }) => score));
  const tied = scored.filter(({ score }) => score === topScore).map(({ voice }) => voice);
  const accentTrait = normalizedAccentKeywords(profile?.accentDescription)
    .map((keyword) => KEYWORD_TRAITS[keyword])
    .find(Boolean);
  const accentMatch = accentTrait ? tied.find((voice) => voice.trait === accentTrait) : null;
  return (accentMatch || tied[0]).name;
}
