"""Apply the reviewed 2014 material-only repair in memory.

No files are changed by this module. Call apply_material_patches(questions),
where questions is a question list (e.g. an early import or subject bank).
All target IDs and fingerprints are checked before any mutation. A second
application is a no-op. Changed stems/options/materials fail closed.
"""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATCH_PATH = HERE / 'question_sources/national-2014-material-patches.reviewed.json'
FACE_FIELDS = ('stem', 'stemBlocks', 'options', 'materialId', 'materialBlocks')


def question_face_hash(question):
    """UTF-8 SHA256 of sorted compact JSON; absent fields normalize to null."""
    face = {field: question.get(field) for field in FACE_FIELDS}
    encoded = json.dumps(face, ensure_ascii=False, sort_keys=True,
                         separators=(',', ':')).encode('utf8')
    return sha256(encoded).hexdigest()


def apply_material_patches(questions, patch_path=PATCH_PATH):
    document = json.loads(Path(patch_path).read_text(encoding='utf8'))
    if document['hashFields'] != list(FACE_FIELDS) or not document['reviewed']:
        raise ValueError('Unexpected or unreviewed material patch format')
    patches = document['questionPatches']
    by_id = {}
    for question in questions:
        qid = question['id']
        if qid in by_id:
            raise ValueError(f'Duplicate question ID: {qid}')
        by_id[qid] = question
    staged = []
    skipped = []
    for patch in patches:
        qid = patch['id']
        if qid not in by_id:
            raise ValueError(f'Reviewed material target missing: {qid}')
        question = by_id[qid]
        actual = question_face_hash(question)
        if actual == patch['expectedAfterSha256']:
            skipped.append(qid)
            continue
        if actual != patch['expectedBeforeSha256']:
            raise ValueError(f'Reviewed material target changed: {qid}; got {actual}')
        if set(patch['set']) != {'materialId', 'materialBlocks'}:
            raise ValueError(f'Non-material change rejected: {qid}')
        candidate = deepcopy(question)
        candidate.update(deepcopy(patch['set']))
        if question_face_hash(candidate) != patch['expectedAfterSha256']:
            raise ValueError(f'Invalid reviewed material result: {qid}')
        staged.append((question, deepcopy(patch['set'])))
    for question, fields in staged:
        question.update(fields)
    return {'patched': len(staged), 'alreadyApplied': len(skipped),
            'targetCount': len(patches)}


def repair_bank(*, write=False):
    root = HERE.parent
    manifest_path = root / 'data/question-bank/manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf8'))
    subjects = {row['id']: json.loads((root / row['path']).read_text(encoding='utf8'))
                for row in manifest['subjects']}
    result = apply_material_patches(subjects['analysis']['questions'])

    def images(value):
        if isinstance(value, dict):
            if value.get('type') == 'image':
                yield value['src']
            for item in value.values():
                yield from images(item)
        elif isinstance(value, list):
            for item in value:
                yield from images(item)

    paths = set(images(subjects))
    if any(not (root / path).is_file() for path in paths):
        raise ValueError('Material repair references a missing image')
    manifest['totals']['imageCount'] = len(paths)
    if write:
        analysis_path = root / next(s['path'] for s in manifest['subjects'] if s['id'] == 'analysis')
        for path, data in ((analysis_path, subjects['analysis']), (manifest_path, manifest)):
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    return {**result, 'imageCount': len(paths)}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    print(json.dumps(repair_bank(write=parser.parse_args().write)))
