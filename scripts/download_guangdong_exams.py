"""Download pinned public source data; never execute upstream code."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.parse import quote, unquote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / 'tmp/guangdong_exam_research'
RAW = RESEARCH / 'raw/ERRRC'
INDEX = json.loads((ROOT/'scripts/question_sources/guangdong-index.json').read_text(encoding='utf8'))


def download(relative):
    path=(RAW/relative).resolve()
    if not path.is_relative_to(RAW.resolve()):
        raise ValueError('Source path escapes raw directory')
    url=f"https://raw.githubusercontent.com/{INDEX['repo']}/{INDEX['commit']}/"+quote(relative,safe='/')
    path.parent.mkdir(parents=True,exist_ok=True)
    for attempt in range(3):
        try:
            if not path.is_file():
                with urlopen(Request(url,headers={'User-Agent':'GuangdongExamSourceResearch/1.0'}),timeout=45) as response:
                    data=response.read()
                if not data: raise ValueError('Empty source file')
                path.write_bytes(data)
            data=path.read_bytes()
            return {'path':relative,'url':url,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        except Exception:
            if attempt==2: raise
            time.sleep(attempt+1)


def main():
    with ThreadPoolExecutor(max_workers=6) as pool:
        records=list(pool.map(download,[row['path'] for row in INDEX['entries']]))
    images=set()
    for row in INDEX['entries']:
        data=(RAW/row['path']).read_bytes()
        if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!=row['sha']:
            raise ValueError('Pinned source hash mismatch: '+row['path'])
        text=data.decode('utf-8-sig')
        images.update(unquote(v).removeprefix('../') for v in re.findall(r'(?:src=["\']|!\[.*?\]\()(\.\./90-[^"\') >]+)',text))
        images.update(v for v in re.findall(r'!\[\[([^\]]+)\]\]',text) if v.startswith('90-'))
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i,record in enumerate(pool.map(download,sorted(images)),1):
            records.append(record)
            if i%100==0: print(f'Images {i}/{len(images)}',flush=True)
    (RESEARCH/'downloads.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(f"Downloaded {len(INDEX['entries'])} module files and {len(images)} referenced images.")


if __name__=='__main__':
    main()
