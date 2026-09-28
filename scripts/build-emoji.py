#!/usr/bin/env python3
"""Build local emoji search data. Network access occurs only when rebuilding."""
from pathlib import Path
import hashlib, json, re, urllib.request, xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
ROOT = Path(__file__).resolve().parents[1]
CLDR = 'https://raw.githubusercontent.com/unicode-org/cldr/release-48/'
URLS = {'emoji-test':'https://unicode.org/Public/17.0.0/emoji/emoji-test.txt', 'ja':CLDR+'common/annotations/ja.xml', 'en':CLDR+'common/annotations/en.xml', 'ja-derived':CLDR+'common/annotationsDerived/ja.xml', 'en-derived':CLDR+'common/annotationsDerived/en.xml', 'license':CLDR+'LICENSE'}
GROUPS = {'Smileys & Emotion':('smileys','Smileys & emotion','😀'), 'People & Body':('people','People & body','👋'), 'Animals & Nature':('animals','Animals & nature','🐱'), 'Food & Drink':('food','Food & drink','🍙'), 'Travel & Places':('travel','Travel & places','🚆'), 'Activities':('activities','Activities','⚽'), 'Objects':('objects','Objects','💡'), 'Symbols':('symbols','Symbols','❤️'), 'Flags':('flags','Flags','🏳️')}
ALIASES = {'猫':['ねこ','neko'],'犬':['いぬ','inu'],'笑顔':['えがお','egao'],'笑う':['わらう','warau'],'涙':['なみだ','namida'],'ハート':['はーと','ha-to','haato'],'ありがとう':['arigatou','arigato'],'誕生日':['たんじょうび','tanjoubi'],'拍手':['はくしゅ','hakushu'],'花':['はな','hana'],'桜':['さくら','sakura'],'星':['ほし','hoshi'],'月':['つき','tsuki'],'雨':['あめ','ame'],'晴れ':['はれ','hare'],'雪':['ゆき','yuki'],'日本':['にほん','nihon','nippon'],'寿司':['すし','sushi'],'コーヒー':['こーひー','ko-hi-','koohii'],'ビール':['びーる','bi-ru','biiru'],'敬礼':['けいれい','keirei'],'いいね':['iine'],'仕事':['しごと','shigoto'],'家':['いえ','ie']}
def fetch(pair):
    key, address = pair
    req = urllib.request.Request(address, headers={'User-Agent':'Enoki-emoji-build/1.0'})
    with urllib.request.urlopen(req, timeout=45) as response:
        return key, response.read()
def canonical(text): return text.replace('\ufe0f', '')
def annotations(raw):
    result = {}
    for node in ET.fromstring(raw).iter('annotation'):
        text = (node.text or '').strip()
        if not text or text in {'↑↑↑','∅∅∅'}: continue
        item = result.setdefault(canonical(node.attrib['cp']), {'name':'','keywords':[]})
        if node.get('type') == 'tts': item['name'] = text
        else: item['keywords'].extend(word.strip() for word in text.split('|'))
    return result
def merge(first, second):
    for key, item in second.items():
        dest = first.setdefault(key, {'name':'','keywords':[]})
        if item['name']: dest['name'] = item['name']
        dest['keywords'].extend(item['keywords'])
    return first
def main():
    with ThreadPoolExecutor(max_workers=6) as pool: raw = dict(pool.map(fetch, URLS.items()))
    ja = merge(annotations(raw['ja-derived']), annotations(raw['ja']))
    en = merge(annotations(raw['en-derived']), annotations(raw['en']))
    entries, seen, group, missing = [], set(), None, 0
    for line in raw['emoji-test'].decode().splitlines():
        if line.startswith('# group: '): group = line.removeprefix('# group: '); continue
        if not line or line.startswith('#') or ';' not in line: continue
        spec, comment = line.split('#', 1)
        points, status = spec.split(';', 1)
        if status.strip() != 'fully-qualified': continue
        cps = [int(point,16) for point in points.split()]
        if any(0x1F3FB <= point <= 0x1F3FF for point in cps): continue
        glyph = ''.join(chr(point) for point in cps)
        if glyph in seen: raise ValueError('Duplicate emoji')
        seen.add(glyph)
        fallback = re.split(r'\sE\d+\.\d+\s',comment.strip(),maxsplit=1)[1]
        key = canonical(glyph)
        j = ja.get(key, {'name':'','keywords':[]})
        e = en.get(key, {'name':fallback,'keywords':[]})
        name = e['name'] or fallback
        missing += not bool(j['name'])
        words = [name,j['name'],fallback] + j['keywords'] + e['keywords']
        for word in list(words): words.extend(ALIASES.get(word, []))
        entries.append({'emoji':glyph,'name':name,'keywords':list(dict.fromkeys(w for w in words if w)),'group':GROUPS[group][0]})
    if len(entries) < 1800 or missing > 10: raise ValueError(f'Unexpected dataset: {len(entries)} entries, {missing} missing Japanese names')
    source = {'unicodeVersion':'17.0','cldrVersion':'48','cldrRef':'release-48','license':'Unicode-3.0','licenseFile':'licenses/unicode.txt','selection':'fully-qualified emoji excluding skin-tone variants','count':len(entries),'japaneseNameFallbackCount':missing,'files':[{'name':key,'url':address,'sha256':hashlib.sha256(raw[key]).hexdigest()} for key,address in URLS.items()],'modifications':'English display names and category labels; merged Japanese and English keywords; added a small set of reading aliases.'}
    payload = {'source':source,'groups':[{'id':v[0],'label':v[1],'icon':v[2]} for v in GROUPS.values()],'emoji':entries}
    (ROOT/'data').mkdir(exist_ok=True)
    (ROOT/'licenses').mkdir(exist_ok=True)
    (ROOT/'data/emoji.json').write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n')
    (ROOT/'licenses/unicode.txt').write_text('Unicode CLDR 48 and Emoji 17.0 data. Sources and checksums: data/emoji.json\n\n'+raw['license'].decode())
    print(json.dumps({'emoji':len(entries),'groups':len(GROUPS),'japaneseNameFallbacks':missing,'bytes':(ROOT/'data/emoji.json').stat().st_size}))
if __name__ == '__main__': main()
