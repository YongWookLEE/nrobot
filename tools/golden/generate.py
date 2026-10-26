"""기존 Python 견적 코드로 기준 정답(골든)을 만든다.

사용법 (nrobot-web 폴더에서):
    python tools/golden/generate.py --legacy ../nrobot_full/web_quote/core

- 기존 코드 폴더는 읽기만 한다. 임시 폴더에 복사한 뒤, 실제 담당자 이름이 박힌
  기본값 표현만 정규식으로 무력화해서 불러온다(가짜 담당자로 실행하기 위함).
- 저장소에 들어가는 결과: tests/golden/*.json, tests/fixtures/*.xlsx (가짜 데이터만)
- 저장소 밖 결과: private/golden/*.json (실제 가격표 해석), private/compare/legacy/* (기존 PDF·Excel)
- 같은 입력이면 항상 같은 결과가 나온다(난수 시드 고정).
"""
import argparse
import importlib
import io
import json
import os
import random
import re
import shutil
import sys
import tempfile
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = ROOT / 'tests' / 'golden'
FIXTURES = ROOT / 'tests' / 'fixtures'
PRIVATE = ROOT / 'private'

# 가짜 담당자 (기존 시작값 1/10/20 구조만 재현)
FAKE_STAFF = [
    {'id': 'a', 'name': '홍길동', 'title': '차장', 'phone': '010-0000-0001', 'start': 1, 'section': '001'},
    {'id': 'b', 'name': '김철수', 'title': '차장', 'phone': '010-0000-0002', 'start': 10, 'section': '010'},
    {'id': 'c', 'name': '이영희', 'title': '대리', 'phone': '010-0000-0003', 'start': 20, 'section': '020'},
]
NAME_TO_ID = {s['name']: s['id'] for s in FAKE_STAFF}


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=str) + '\n', encoding='utf-8')


def half_up(v):
    return int(Decimal(v).quantize(Decimal(1), rounding=ROUND_HALF_UP))


# ---------------------------------------------------------------- 합성 엑셀 작성

def _inline(ref, text, style=None):
    s = f' s="{style}"' if style is not None else ''
    t = (str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))
    return f'<c r="{ref}" t="inlineStr"{s}><is><t xml:space="preserve">{t}</t></is></c>'


def _num(ref, value, style=None, formula=None):
    s = f' s="{style}"' if style is not None else ''
    f = f'<f>{formula}</f>' if formula else ''
    return f'<c r="{ref}"{s}>{f}<v>{value}</v></c>'


CT_BASE = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
           '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
           '<Default Extension="xml" ContentType="application/xml"/>'
           '<Default Extension="png" ContentType="image/png"/>'
           '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
           '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
           '{sheets}{drawings}</Types>')
NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'

STYLES = (f'<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="{NS_MAIN}">'
          '<fonts count="4">'
          '<font><sz val="11"/><color theme="1"/><name val="맑은 고딕"/></font>'
          '<font><b/><sz val="12"/><color rgb="FFC00000"/><name val="KoPub돋움체 Medium"/></font>'
          '<font><sz val="10"/><color theme="4" tint="0.3999755851924192"/><name val="KoPub돋움체 Medium"/></font>'
          '<font><sz val="9"/><color theme="1" tint="-0.249977111117893"/><name val="맑은 고딕"/></font>'
          '</fonts>'
          '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
          '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>'
          '<fill><patternFill patternType="solid"><fgColor theme="2" tint="-0.0999786370433668"/><bgColor indexed="64"/></patternFill></fill>'
          '</fills><borders count="1"><border/></borders>'
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
          '<cellXfs count="5">'
          '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'
          '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyAlignment="1"><alignment horizontal="center"/></xf>'
          '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="left"/></xf>'
          '<xf numFmtId="0" fontId="3" fillId="3" borderId="0" applyAlignment="1"><alignment horizontal="right"/></xf>'
          '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center"/></xf>'
          '</cellXfs></styleSheet>')

THEME = ('<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="t">'
         '<a:themeElements><a:clrScheme name="t">'
         '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
         '<a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2>'
         '<a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2>'
         '<a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>'
         '<a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>'
         '<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink>'
         '</a:clrScheme></a:themeElements></a:theme>')


def _sheet_xml(rows, cols='', heights=None, drawing=False):
    heights = heights or {}
    out = []
    for r in sorted(rows):
        ht = f' ht="{heights[r]}" customHeight="1"' if r in heights else ''
        out.append(f'<row r="{r}"{ht}>' + ''.join(rows[r]) + '</row>')
    d = f'<drawing r:id="rId1"/>' if drawing else ''
    return (f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="{NS_MAIN}" xmlns:r="{NS_R}">'
            f'{cols}<sheetData>{"".join(out)}</sheetData>{d}</worksheet>')


def _write_book(path, sheets, images=None, drawing_xml=None, drawing_sheet=None):
    """sheets: [(name, sheet_xml)]. drawing on sheet index drawing_sheet."""
    files = {}
    s_over = ''.join(f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(len(sheets)))
    d_over = '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' if drawing_xml else ''
    files['[Content_Types].xml'] = CT_BASE.format(sheets=s_over, drawings=d_over)
    files['_rels/.rels'] = f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{NS_PKG}"><Relationship Id="rId1" Type="{NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    files['xl/workbook.xml'] = (f'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="{NS_MAIN}" xmlns:r="{NS_R}"><sheets>'
                                + ''.join(f'<sheet name="{n}" sheetId="{i+1}" r:id="rId{i+1}"/>' for i, (n, _) in enumerate(sheets))
                                + '</sheets></workbook>')
    rels = ''.join(f'<Relationship Id="rId{i+1}" Type="{NS_R}/worksheet" Target="worksheets/sheet{i+1}.xml"/>' for i in range(len(sheets)))
    rels += f'<Relationship Id="rId{len(sheets)+1}" Type="{NS_R}/styles" Target="styles.xml"/>'
    rels += f'<Relationship Id="rId{len(sheets)+2}" Type="{NS_R}/theme" Target="theme/theme1.xml"/>'
    files['xl/_rels/workbook.xml.rels'] = f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{NS_PKG}">{rels}</Relationships>'
    files['xl/styles.xml'] = STYLES
    files['xl/theme/theme1.xml'] = THEME
    for i, (_, xml) in enumerate(sheets):
        files[f'xl/worksheets/sheet{i+1}.xml'] = xml
    if drawing_xml:
        files[f'xl/worksheets/_rels/sheet{drawing_sheet+1}.xml.rels'] = f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{NS_PKG}"><Relationship Id="rId1" Type="{NS_R}/drawing" Target="../drawings/drawing1.xml"/></Relationships>'
        files['xl/drawings/drawing1.xml'] = drawing_xml
        drels = ''.join(f'<Relationship Id="rId{i+1}" Type="{NS_R}/image" Target="../media/image{i+1}.png"/>' for i in range(len(images)))
        files['xl/drawings/_rels/drawing1.xml.rels'] = f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{NS_PKG}">{drels}</Relationships>'
        for i, blob in enumerate(images):
            files[f'xl/media/image{i+1}.png'] = blob
    path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(path, 'w', ZIP_DEFLATED) as z:
        for name in sorted(files):
            info_data = files[name]
            z.writestr(name, info_data if isinstance(info_data, bytes) else info_data.encode('utf-8'))


def make_access_fixture(path):
    rows = {}
    rows[1] = [_inline('A1', '출입통제 기준가격 (시험용 가짜 데이터)')]
    rows[3] = [_inline('A3', '소요군'), _inline('B3', '품목'), _inline('C3', '제품명'), _inline('D3', '단가'), _inline('E3', '비고')]
    data = [
        ('출입관리', '안면인식단말기', 'TEST-FACE01', 1234567, '시험 비고'),
        ('출입관리', '출입통제 DCU', 'TEST-DCU10', 890000, ''),
        ('잠금장치', 'EM-Lock', 'TEST-EM600', 150000, '1번 행'),
        ('잠금장치', 'EM-Lock', 'TEST-EM600', 160000.4, '같은 모델 2번 행'),
        ('공사', '설치비', '', 300000, ''),
        ('공사', '기존 장비 철거', '', 120000.5, ''),
        ('공사', '이전설치', '', 250000, ''),
        ('공사', '배관배선', '', 80000, '미터당'),
        ('기타', '퇴실버튼', 'TEST-EB30', 0, ''),
    ]
    for i, (g, t, m, p, n) in enumerate(data, 4):
        cells = [_inline(f'A{i}', g), _inline(f'B{i}', t)]
        if m:
            cells.append(_inline(f'C{i}', m))
        cells.append(_num(f'D{i}', p))
        if n:
            cells.append(_inline(f'E{i}', n))
        rows[i] = cells
    rows[14] = [_inline('A14', '공사'), _inline('B14', '')]  # 품목 빈 행은 건너뜀
    _write_book(path, [('기준가격', _sheet_xml(rows))])


def _png(color, size):
    from PIL import Image
    im = Image.new('RGBA', size, color)
    for x in range(size[0]):
        im.putpixel((x, x * size[1] // size[0]), (0, 0, 0, 255))
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    return buf.getvalue()


def _anchor(col, row, cx, cy, rid, crop=None):
    src = f'<a:srcRect l="{crop[0]}" t="{crop[1]}" r="{crop[2]}" b="{crop[3]}"/>' if crop else ''
    return ('<xdr:oneCellAnchor><xdr:from><xdr:col>{c}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{r}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'
            '<xdr:ext cx="{cx}" cy="{cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="{i}" name="p{i}"/><xdr:cNvPicPr/></xdr:nvPicPr>'
            '<xdr:blipFill><a:blip r:embed="{rid}"/>{src}<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>'
            '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>'
            ).format(c=col, r=row, cx=cx, cy=cy, rid=rid, src=src, i=abs(hash((col, row))) % 1000 + 2)


def make_catalog_fixture(path):
    cols = ('<cols><col min="1" max="1" width="5.5" customWidth="1"/><col min="2" max="2" width="12" customWidth="1"/>'
            '<col min="3" max="3" width="30" customWidth="1"/><col min="4" max="4" width="0" hidden="1" customWidth="1"/>'
            '<col min="5" max="5" width="4" customWidth="1"/><col min="6" max="6" width="6" customWidth="1"/>'
            '<col min="7" max="7" width="6" customWidth="1"/><col min="8" max="8" width="13" customWidth="1"/>'
            '<col min="9" max="9" width="13" customWidth="1"/><col min="10" max="10" width="16" customWidth="1"/></cols>')

    def head(rows):
        rows[16] = [_inline('D16', '견적 유효기간 : 발행일로부터 60일'), _inline('J16', '조달수수료(0.54%) 총계 포함')]
        rows[17] = [_inline('D17', '납품 : 발주 후 4주')]
        rows[18] = [_inline('D18', '결제 : 납품 후 현금')]
        rows[20] = [_inline('A20', '순번', 4), _inline('B20', '구분', 4), _inline('C20', '품목', 1)]

    # 시트1: 모델명 줄, 영숫자-영숫자 줄, 수식 단가, 빈 단가, B열 이어받기, 사진
    r1, h1 = {}, {20: 22.5, 21: 18, 22: 15, 23: 15, 24: 30, 25: 15, 26: 15, 27: 15, 28: 15, 29: 15}
    head(r1)
    r1[21] = [_num('A21', 1, 4), _inline('B21', '출입관리', 4), _inline('C21', '시험 단말기 세트', 1), _inline('F21', '대', 4), _num('G21', 2, 4), _num('H21', 1500000, 3), _inline('J21', '조달 식별 번호, 12345678', 4)]
    r1[22] = [_inline('C22', '모델명 : TEST-A100/ 흰색', 2), _inline('K22', '내부 참고 메모')]
    r1[23] = [_inline('C23', '크기 100x200', 2)]
    r1[24] = [_num('A24', 2, 4), _inline('C24', '시험 컨트롤러', 1), _inline('F24', '식', 4), _num('G24', 1, 4), _num('H24', 300000, 3, formula='H21*0.2'), _inline('J24', '수식 단가', 4)]
    r1[25] = [_inline('C25', 'TEST-B200 / 4도어', 2)]
    r1[26] = [_num('A26', 3, 4), _inline('C26', '단가 없는 품목', 1), _inline('F26', 'EA', 4), _num('G26', 3, 4)]
    r1[27] = [_num('A27', 4, 4), _inline('C27', '단가 이상 품목', 1), _inline('F27', 'EA', 4), _num('G27', 1, 4), _inline('H27', '협의', 3)]
    r1[28] = [_inline('A28', '합 계')]
    r1[30] = [_inline('A30', '1. 시험용 참고사항 하나')]
    r1[31] = [_inline('A31', '2. 시험용 참고사항 둘')]
    r1[32] = [_inline('A32', '번호 없는 줄은 무시')]
    drawing = ('<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" '
               'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + NS_R + '">'
               + _anchor(9, 20, 900000, 700000, 'rId1')
               + _anchor(9, 22, 600000, 600000, 'rId2', crop=(10000, 20000, 10000, 0))
               + _anchor(9, 23, 50000, 50000, 'rId1')  # 너무 작은 그림: 무시
               + _anchor(11, 20, 900000, 700000, 'rId1')  # J열 밖: 무시
               + '</xdr:wsDr>')
    s1 = _sheet_xml(r1, cols, h1, drawing=True)

    # 시트2: 같은 시트·모델·첫 줄 중복(id 접미사), B열 비면 시트명
    r2, h2 = {}, {21: 20, 22: 20}
    head(r2)
    r2[21] = [_num('A21', 1, 4), _inline('C21', '중복 품목', 1), _inline('F21', '대', 4), _num('G21', 1, 4), _num('H21', 50000000, 3)]
    r2[22] = [_inline('C22', 'TEST-C300', 2)]
    r2[23] = [_num('A23', 2, 4), _inline('C23', '중복 품목', 1), _inline('F23', '대', 4), _num('G23', 1, 4), _num('H23', 25, 3)]
    r2[24] = [_inline('C24', 'TEST-C300', 2)]
    r2[25] = [_inline('A25', '합계')]
    s2 = _sheet_xml(r2, cols, h2)

    s3 = _sheet_xml({1: [_inline('A1', '품목 없는 시트')]})
    _write_book(path, [('시험제품A', s1), ('시험제품B', s2), ('빈시트', s3)],
                images=[_png((30, 120, 200, 255), (300, 200)), _png((200, 60, 40, 255), (200, 200))],
                drawing_xml=drawing, drawing_sheet=0)


# ---------------------------------------------------------------- 기존 코드 불러오기

def load_legacy(legacy_dir, work):
    copy = work / 'core'
    shutil.copytree(legacy_dir, copy)
    v = copy / 'validation.py'
    src = v.read_text(encoding='utf-8')
    src2 = re.sub(r"raw\.get\('staffPhone',\{[^{}]*\}\[d\['staff'\]\]\)", "raw.get('staffPhone','')", src)
    assert src2 != src, 'validation.py 패턴을 찾지 못했습니다'
    v.write_text(src2, encoding='utf-8')
    p = copy / 'pdf_quote.py'
    src = p.read_text(encoding='utf-8')
    src2 = re.sub(r"person,phone=\{[^\n]*\}\[staff\]", "person,phone=('','')", src)
    assert src2 != src, 'pdf_quote.py 패턴을 찾지 못했습니다'
    p.write_text(src2, encoding='utf-8')
    staff_file = work / 'staff.txt'
    staff_file.write_text(''.join(f"[{s['section']}]\n이름 = {s['name']}\n직급 = {s['title']}\n휴대폰 = {s['phone']}\n\n" for s in FAKE_STAFF), encoding='utf-8-sig')
    os.environ['NROBOTICS_DATA_DIR'] = str(work / 'data')
    os.environ['NROBOTICS_STAFF_FILE'] = str(staff_file)
    os.environ['NROBOTICS_CATALOG_FILE'] = str(FIXTURES / 'catalog.xlsx')
    os.environ['NROBOTICS_ACCESS_FILE'] = str(FIXTURES / 'access.xlsx')
    sys.path.insert(0, str(copy))
    mods = {}
    for name in ('quote', 'numbering', 'staff_settings', 'catalog', 'access_catalog', 'validation', 'pdf_quote', 'xlsx_quote'):
        mods[name] = importlib.import_module(name)
    mods['numbering'].STARTS = {s['name']: s['start'] for s in FAKE_STAFF}
    mods['staff_settings'].KEYS = {s['name']: s['section'] for s in FAKE_STAFF}
    return mods


# ---------------------------------------------------------------- 계산

def calc_cases(m):
    quote = m['quote']
    rng = random.Random(20261026)
    cases = []
    prices = [0, 1, 7, 99, 128000, 1000000, 33333333, 99999999]
    rates = [100, 77, 90, 0, 99.99, 50, 12.5]
    qtys = [1, 2, 3, 1.125, 0.5, 0.001, 7.333, 10]

    def item(kind):
        it = {'qty': rng.choice(qtys), 'priceRate': rng.choice(rates)}
        if kind == 'cost':
            mat = rng.choice(prices)
            lab = half_up(Decimal(mat) * Decimal('2.8125')) if rng.random() < .6 else rng.choice(prices)
            exp = half_up(Decimal(lab) * Decimal('0.03')) if rng.random() < .6 else rng.choice(prices)
            it.update(material=mat, labor=lab, expense=exp, price=0)
        else:
            it['price'] = rng.choice(prices)
        return it

    def record(cid, kind, items):
        out = {'id': cid, 'quoteType': kind, 'items': items}
        try:
            out['lines'] = [quote.line_amount(i, kind) for i in items]
            s, t, total = quote.calculate(items, kind)
            out['expected'] = {'subtotal': s, 'tax': t, 'total': total}
            if kind in ('catalog', 'catalog2'):
                d, fee, withfee = quote.catalog_totals(s)
                out['catalogTotals'] = {'discounted': d, 'fee': fee, 'withFee': withfee}
        except ValueError as e:
            out['error'] = str(e)
        cases.append(out)

    for kind in ('vat', 'total', 'cost', 'catalog', 'catalog2'):
        for n in (1, 2, 3, 4, 5, 8, 9, 10, 20, 40, 100):
            record(f'{kind}-n{n}', kind, [item(kind) for _ in range(n)])
    # 경계값
    for kind in ('catalog', 'catalog2'):
        for p in (49999999, 50000000, 50000001, 50000025, 50000075, 100000000000):
            record(f'{kind}-boundary-{p}', kind, [{'qty': 1, 'price': p, 'priceRate': 100}])
        record(f'{kind}-rate-boundary', kind, [{'qty': 1, 'price': 100000000, 'priceRate': 50}])
        record(f'{kind}-rate-just-below', kind, [{'qty': 1, 'price': 100000000, 'priceRate': 49.99}])
    for kind in ('vat', 'cost', 'total'):
        record(f'{kind}-half-line', kind, [{'qty': 0.5, 'price': 1, 'priceRate': 100, 'material': 1, 'labor': 0, 'expense': 0}])
        record(f'{kind}-half-rate', kind, [{'qty': 1, 'price': 1, 'priceRate': 50, 'material': 1, 'labor': 0, 'expense': 0}])
        record(f'{kind}-vat-half', kind, [{'qty': 1, 'price': 5, 'priceRate': 100, 'material': 5, 'labor': 0, 'expense': 0}])
        record(f'{kind}-zero', kind, [{'qty': 1, 'price': 0, 'priceRate': 100, 'material': 0, 'labor': 0, 'expense': 0}])
        record(f'{kind}-max', kind, [{'qty': 1000000, 'price': 100000000000, 'priceRate': 100, 'material': 100000000000, 'labor': 100000000000, 'expense': 100000000000}])
        record(f'{kind}-near-max', kind, [{'qty': 9, 'price': 100000000000, 'priceRate': 100, 'material': 100000000000, 'labor': 0, 'expense': 0}])
    auto = []
    for mat in (0, 1, 2, 3, 7, 8, 16, 99, 128000, 1000001, 3333333, 100000000000):
        lab = half_up(Decimal(mat) * Decimal('2.8125'))
        auto.append({'material': mat, 'autoLabor': lab, 'autoExpenseFromLabor': half_up(Decimal(lab) * Decimal('0.03'))})
    for lab in (0, 16, 17, 50, 83, 84, 16666, 16667):
        auto.append({'labor': lab, 'autoExpense': half_up(Decimal(lab) * Decimal('0.03'))})
    return {'cases': cases, 'auto': auto}


# ---------------------------------------------------------------- 검증

def to_new_shape(raw):
    new = {k: v for k, v in raw.items() if k not in ('staff', 'notes', 'numberManual', 'outputFormat', 'staffPhones')}
    if 'staff' in raw:
        new['staffId'] = NAME_TO_ID.get(raw['staff'], raw['staff'])
    if 'notes' in raw:
        new['notes'] = '\n'.join(n for n in raw['notes'] if n) if isinstance(raw['notes'], list) else raw['notes']
    new['format'] = 'pdf'
    return new


def base_raw(**over):
    raw = {'quoteType': 'vat', 'outputFormat': 'pdf', 'customer': ' 시험 거래처 ', 'contact': '담당 과장', 'phone': '02-000-0000',
           'email': 'test@example.com', 'title': '시험 견적', 'number': 'NSFF0-20261026-001', 'numberManual': True,
           'date': '2026-10-26', 'staff': '홍길동', 'staffPhone': '010-0000-0001', 'validity': '발행일로부터 30일',
           'delivery': '협의', 'payment': '고객사와 협의', 'notes': ['1. 해당 건에 대한 견적가격입니다.', ''],
           'showFee': True, 'mergeCategories': True, 'blankRows': True,
           'items': [{'category': '장비', 'name': '시험 품목', 'unit': '식', 'qty': '1', 'price': '1000', 'priceRate': 100}]}
    raw.update(over)
    return raw


def validation_cases(m):
    val = m['validation']
    cat = m['catalog'].read()
    first = cat['entries'][0]
    long = 'ㄱ' * 501
    specs = [
        ('ok-vat', base_raw()),
        ('ok-total', base_raw(quoteType='total')),
        ('ok-cost', base_raw(quoteType='cost', items=[{'category': '설치', 'name': '비용', 'unit': '식', 'qty': '1.125', 'material': '1000', 'labor': '2813', 'expense': '84', 'priceRate': '90'}])),
        ('ok-notes-two', base_raw(notes=['첫째 줄', '둘째 줄'])),
        ('ok-options-off', base_raw(showFee=False, mergeCategories=False, blankRows=False)),
        ('ok-other-staff', base_raw(staff='이영희', staffPhone=' 010-1111-2222 ')),
        ('ok-catalog-linked', base_raw(quoteType='catalog', catalogRevision=cat['revision'], items=[{'catalogId': first['id'], 'name': '덮어써질 이름', 'category': 'x', 'unit': 'x', 'note': 'x', 'qty': '2', 'price': '1', 'priceRate': '100', 'imageIds': []}])),
        ('ok-catalog-unlinked-images', base_raw(quoteType='catalog2', catalogRevision=cat['revision'], items=[{'name': '직접 입력', 'unit': '대', 'qty': '1', 'price': '1000', 'priceRate': '100', 'imageIds': ['없는사진', *first['imageIds'][:1]]}])),
        ('err-type', base_raw(quoteType='other')),
        ('err-format', base_raw(outputFormat='doc')),
        ('err-customer', base_raw(customer='  ')),
        ('err-title', base_raw(title='')),
        ('err-long', base_raw(contact=long)),
        ('err-staff', base_raw(staff='없는사람')),
        ('err-phone', base_raw(staffPhone='0' * 31)),
        ('err-manual-number', base_raw(number='')),
        ('err-items-empty', base_raw(items=[])),
        ('err-items-101', base_raw(items=[{'name': 'a', 'unit': '식', 'qty': '1', 'price': '1'}] * 101)),
        ('err-name', base_raw(items=[{'name': ' ', 'unit': '식', 'qty': '1', 'price': '1'}])),
        ('err-unit', base_raw(items=[{'name': 'a', 'unit': '', 'qty': '1', 'price': '1'}])),
        ('err-qty-zero', base_raw(items=[{'name': 'a', 'unit': '식', 'qty': '0', 'price': '1'}])),
        ('err-qty-decimals', base_raw(items=[{'name': 'a', 'unit': '식', 'qty': '1.0001', 'price': '1'}])),
        ('err-qty-max', base_raw(items=[{'name': 'a', 'unit': '식', 'qty': '1000001', 'price': '1'}])),
        ('err-price-fraction', base_raw(items=[{'name': 'a', 'unit': '식', 'qty': '1', 'price': '1.5'}])),
        ('err-price-max', base_raw(items=[{'name': 'a', 'unit': '식', 'qty': '1', 'price': '100000000001'}])),
        ('err-rate', base_raw(items=[{'name': 'a', 'unit': '식', 'qty': '1', 'price': '1', 'priceRate': '100.01'}])),
        ('err-rate-decimals', base_raw(items=[{'name': 'a', 'unit': '식', 'qty': '1', 'price': '1', 'priceRate': '99.999'}])),
        ('err-cost-missing', base_raw(quoteType='cost', items=[{'name': 'a', 'unit': '식', 'qty': '1', 'material': '1', 'labor': '1'}])),
        ('err-cost-fraction', base_raw(quoteType='cost', items=[{'name': 'a', 'unit': '식', 'qty': '1', 'material': '1', 'labor': '1', 'expense': '0.5'}])),
        ('err-item-long', base_raw(items=[{'name': long, 'unit': '식', 'qty': '1', 'price': '1'}])),
        ('ok-catalog-item-long', base_raw(quoteType='catalog', catalogRevision=cat['revision'], items=[{'name': long, 'unit': '식', 'qty': '1', 'price': '1'}])),
        ('err-notes-long', base_raw(notes=['가' * 1001, '나' * 1000])),
        ('err-total-overflow', base_raw(items=[{'name': 'a', 'unit': '식', 'qty': '1000000', 'price': '100000000000'}])),
        ('err-catalog-revision', base_raw(quoteType='catalog', catalogRevision='old', items=[{'name': 'a', 'unit': '식', 'qty': '1', 'price': '1'}])),
        ('err-catalog-missing', base_raw(quoteType='catalog', catalogRevision=cat['revision'], items=[{'catalogId': 'gone', 'name': 'a', 'unit': '식', 'qty': '1', 'price': '1'}])),
    ]
    cases = []
    for cid, raw in specs:
        out = {'id': cid, 'legacyInput': raw, 'input': to_new_shape(raw)}
        try:
            d = val.validate(json.loads(json.dumps(raw)))
            keep = {k: d[k] for k in ('quoteType', 'customer', 'contact', 'phone', 'email', 'title', 'number', 'date',
                                      'validity', 'delivery', 'payment', 'staffPhone', 'staffDisplay', 'notes',
                                      'showFee', 'mergeCategories', 'blankRows')}
            keep['notes'] = d['notes'][0]
            keep['staffId'] = NAME_TO_ID[d['staff']]
            keep['items'] = [{k: v for k, v in it.items() if k not in ('template',)} for it in d['items']]
            out['expected'] = keep
        except (ValueError, KeyError, TypeError) as e:
            out['error'] = str(e) if isinstance(e, ValueError) else '품목과 금액 입력을 확인하세요.'
        cases.append(out)
    return {'catalogRevision': cat['revision'], 'cases': cases}


# ---------------------------------------------------------------- 견적번호

def numbering_scenarios(m, work):
    num = m['numbering']
    scenarios = []

    def run(name, ops):
        num.DB = work / f'num-{name}.sqlite3'
        if num.DB.exists():
            num.DB.unlink()
        steps = []
        for op in ops:
            step = dict(op)
            try:
                if op['op'] == 'preview':
                    step['result'] = num.preview(op['day'], op['staff'])
                else:
                    def create(number, fail=op.get('fail', False)):
                        if fail:
                            raise RuntimeError('생성 실패')
                        return Path('out') / number
                    _, number = num.issue(op['day'], op['staff'], create, op.get('manual'))
                    step['result'] = number
            except RuntimeError as e:
                step['error'] = 'FAILED_GENERATION'
            except ValueError as e:
                step['error'] = str(e)
            step['staffId'] = NAME_TO_ID.get(op['staff'], op['staff'])
            steps.append(step)
        scenarios.append({'name': name, 'steps': steps})

    D, D2 = '2026-10-26', '2026-10-27'
    A, B, C = '홍길동', '김철수', '이영희'
    run('first-each', [{'op': 'issue', 'day': D, 'staff': s} for s in (A, B, C)])
    run('sequence', [{'op': 'issue', 'day': D, 'staff': A} for _ in range(3)] + [{'op': 'preview', 'day': D, 'staff': A}])
    run('overflow-into-next-range', [{'op': 'issue', 'day': D, 'staff': A} for _ in range(10)] + [{'op': 'issue', 'day': D, 'staff': B}, {'op': 'issue', 'day': D, 'staff': A}])
    run('manual-skip', [{'op': 'issue', 'day': D, 'staff': A, 'manual': 'NSFF0-20261026-002'}, {'op': 'issue', 'day': D, 'staff': A},
                        {'op': 'issue', 'day': D, 'staff': A}, {'op': 'issue', 'day': D, 'staff': A, 'manual': 'NSFF0-20261026-002'},
                        {'op': 'issue', 'day': D, 'staff': B, 'manual': 'NSFF0-20261026-001'}, {'op': 'issue', 'day': D, 'staff': B, 'manual': 'ABC-1'},
                        {'op': 'issue', 'day': D, 'staff': C, 'manual': 'ABC-1'}, {'op': 'issue', 'day': D, 'staff': B, 'manual': 'NSFF0-20261026-010'},
                        {'op': 'issue', 'day': D, 'staff': B}, {'op': 'issue', 'day': D2, 'staff': A, 'manual': 'NSFF0-20261026-003'}])
    run('manual-invalid', [{'op': 'issue', 'day': D, 'staff': A, 'manual': ' '}, {'op': 'issue', 'day': D, 'staff': A, 'manual': 'X' * 101},
                           {'op': 'issue', 'day': D, 'staff': A, 'manual': 'A\tB'}, {'op': 'issue', 'day': D, 'staff': A, 'manual': 'X' * 100}])
    run('failure-not-consumed', [{'op': 'preview', 'day': D, 'staff': A}, {'op': 'issue', 'day': D, 'staff': A, 'fail': True},
                                 {'op': 'preview', 'day': D, 'staff': A}, {'op': 'issue', 'day': D, 'staff': A},
                                 {'op': 'issue', 'day': D, 'staff': A, 'manual': 'M-1', 'fail': True}, {'op': 'issue', 'day': D, 'staff': A, 'manual': 'M-1'}])
    run('day-reset', [{'op': 'issue', 'day': D, 'staff': A}, {'op': 'issue', 'day': D2, 'staff': A}, {'op': 'issue', 'day': D, 'staff': A}])
    run('unknown-staff', [{'op': 'issue', 'day': D, 'staff': '없는사람'}, {'op': 'preview', 'day': D, 'staff': '없는사람'}])
    run('exhaust', [{'op': 'issue', 'day': D, 'staff': C} for _ in range(981)] + [{'op': 'issue', 'day': D, 'staff': C}, {'op': 'issue', 'day': D, 'staff': A}])
    # exhaust: C uses 020..999 (980개) then 981번째에서 오류 → 아래 요약만 남겨 파일 크기를 줄인다
    ex = scenarios[-1]
    ex['steps'] = ex['steps'][:2] + [{'summary': f"{len(ex['steps']) - 4} more issues"}] + ex['steps'][-4:]
    return {'starts': {NAME_TO_ID[k]: v for k, v in num.STARTS.items()}, 'scenarios': scenarios}


# ---------------------------------------------------------------- 표기

def formatting(m):
    pq = m['pdf_quote']
    amounts = [0, 1, 10, 11, 19, 100, 101, 110, 1000, 1001, 10000, 10001, 11111, 100000, 1000000, 10010000, 12345678,
               100000000, 100010000, 123456789012, 999999999999, 1000000000000, 9999999999999]
    groups = [
        ['장비', '장비', '설치', '', '', '설치', '설치'],
        [' 장비 ', '장비', '장비 ', ''],
        ['a'],
        ['', ''],
    ]
    notes = ['조달식별번호 12345678', '조달 식별 번호, 1234-5678', '조달 식별번호： 99', '일반 비고', '조달식별번호 없음']
    return {
        'koreanAmount': [{'n': n, 'text': pq.korean_amount(n)} for n in amounts],
        'categoryGroups': [{'categories': g, 'enabled': e, 'numbers': pq.category_groups([{'category': c} for c in g], e),
                            'spans': [list(map(str, c)) for c in pq.category_spans([{'category': c} for c in g], e)]}
                           for g in groups for e in (True, False)],
        'itemNote': [{'in': n, 'out': pq.format_item_note(n)} for n in notes],
        'qtyText': [{'qty': q, 'text': f'{q:g}'} for q in (1.0, 3.0, 1.125, 0.001, 7.333, 1234.125, 999999.0, 1000000.0, 0.5)],
    }


# ---------------------------------------------------------------- 가격표 해석

def pricelist_summary(m, access_path, catalog_path):
    acc_mod, cat_mod = m['access_catalog'], m['catalog']
    old_a, old_c = os.environ['NROBOTICS_ACCESS_FILE'], os.environ['NROBOTICS_CATALOG_FILE']
    try:
        os.environ['NROBOTICS_ACCESS_FILE'] = str(access_path)
        acc = acc_mod.read()
        acc.pop('path', None)
        parsed = cat_mod.parse(catalog_path)
        entries = []
        for e in parsed['entries']:
            e = dict(e)
            e['imageCount'] = len(e.pop('imageIds'))
            t = dict(e['template'])
            t['imageSizes'] = sorted([round(w, 4), round(h, 4)] for w, h in t['imageSizes'].values())
            e['template'] = t
            entries.append(e)
        return {'access': acc, 'catalog': {'entries': entries, 'sheets': parsed['sheets'], 'warnings': parsed['warnings'], 'imageCount': len(parsed['images'])}}
    finally:
        os.environ['NROBOTICS_ACCESS_FILE'], os.environ['NROBOTICS_CATALOG_FILE'] = old_a, old_c


# ---------------------------------------------------------------- 비교용 기존 PDF·Excel

def render_inputs(m):
    cat = m['catalog'].read()
    e = cat['entries']
    rng = random.Random(7)

    def items(kind, n):
        out = []
        for i in range(n):
            if kind in ('catalog', 'catalog2'):
                src = e[i % len(e)]
                out.append({'catalogId': src['id'], 'name': src['name'], 'category': src['category'], 'unit': src['unit'] or '대',
                            'note': src['note'], 'qty': '1', 'price': str(src['price'] if src['price'] is not None else 777000), 'priceRate': '100', 'imageIds': src['imageIds']})
            else:
                cat_name = ['장비', '장비', '설치', '개발', ''][i % 5]
                out.append({'category': cat_name, 'name': f'시험 품목 {i+1}' + ('\n상세 규격 설명 줄' if i % 3 == 0 else ''), 'unit': '식',
                            'qty': str([1, 2, 1.125][i % 3]), 'price': str(rng.choice([128000, 1500000, 33000])), 'priceRate': str([100, 90, 77][i % 3]),
                            'material': str(1000 * (i + 1)), 'labor': str(half_up(Decimal(1000 * (i + 1)) * Decimal('2.8125'))), 'expense': '84',
                            'note': '조달식별번호 12345678' if i == 1 else ('현장 적용' if i % 2 else '')})
        return out

    specs = [('vat-3', 'vat', 3), ('total-3', 'total', 3), ('cost-3', 'cost', 3), ('vat-20', 'vat', 20),
             ('catalog-1', 'catalog', 1), ('catalog-4', 'catalog', 4), ('catalog-5', 'catalog', 5), ('catalog2-9', 'catalog2', 9)]
    out = []
    for name, kind, n in specs:
        raw = base_raw(quoteType=kind, outputFormat='both', number=f'NSFF0-20261026-{len(out)+1:03d}',
                       title=f'시험 견적 {name}', customer='시험 거래처(주)', items=items(kind, n),
                       notes=['1. 해당 건에 대한 견적가격입니다.\n2. 조달수수료(0.54%) 합계 포함', ''] if kind.startswith('catalog') else ['1. 해당 건에 대한 견적가격입니다.', ''])
        if kind.startswith('catalog'):
            raw['catalogRevision'] = cat['revision']
        out.append({'name': name, 'legacyInput': raw, 'input': to_new_shape(raw)})
    return out


def render_legacy(m, inputs, work):
    target = PRIVATE / 'compare' / 'legacy'
    target.mkdir(parents=True, exist_ok=True)
    fonts = work / 'fonts'
    fonts.mkdir(exist_ok=True)
    shutil.copy2(ROOT / 'assets' / 'fonts' / 'KoPubDotum-Medium.ttf', fonts / 'KoPubDotumMedium.ttf')
    shutil.copy2(ROOT / 'assets' / 'fonts' / 'KoPubDotum-Bold.ttf', fonts / 'KoPubDotumBold.ttf')
    for f in ('malgun.ttf', 'malgunbd.ttf'):
        src = PRIVATE / 'fonts' / f
        if src.exists():
            shutil.copy2(src, fonts / f)
    os.environ['NROBOTICS_FONT_DIR'] = str(fonts)
    results = []
    for spec in inputs:
        d = m['validation'].validate(json.loads(json.dumps(spec['legacyInput'])))
        pdf = target / f"{spec['name']}.pdf"
        xlsx = target / f"{spec['name']}.xlsx"
        info = m['pdf_quote'].write_pdf(d, pdf)
        m['xlsx_quote'].write_xlsx(d, xlsx)
        results.append({'name': spec['name'], 'pages': info['pages'], 'total': info['total']})
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--legacy', required=True, help='nrobot_full/web_quote/core 경로 (읽기 전용)')
    args = ap.parse_args()
    legacy = Path(args.legacy).resolve()
    if not (legacy / 'quote.py').exists():
        sys.exit(f'기존 코드 폴더가 아닙니다: {legacy}')
    make_access_fixture(FIXTURES / 'access.xlsx')
    make_catalog_fixture(FIXTURES / 'catalog.xlsx')
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        m = load_legacy(legacy, work)
        dump(GOLDEN / 'calc.json', calc_cases(m))
        dump(GOLDEN / 'validation.json', validation_cases(m))
        dump(GOLDEN / 'numbering.json', numbering_scenarios(m, work))
        dump(GOLDEN / 'format.json', formatting(m))
        dump(GOLDEN / 'pricelists.json', pricelist_summary(m, FIXTURES / 'access.xlsx', FIXTURES / 'catalog.xlsx'))
        inputs = render_inputs(m)
        dump(GOLDEN / 'render_inputs.json', inputs)
        real_a, real_c = PRIVATE / 'prices' / 'access.xlsx', PRIVATE / 'prices' / 'catalog.xlsx'
        if real_a.exists() and real_c.exists():
            dump(PRIVATE / 'golden' / 'pricelists.json', pricelist_summary(m, real_a, real_c))
            print('실제 가격표 기준 데이터: private/golden/pricelists.json')
        else:
            print('private/prices 가 없어 실제 가격표 기준 데이터는 건너뜀')
        if (PRIVATE / 'fonts' / 'malgun.ttf').exists():
            dump(PRIVATE / 'compare' / 'legacy' / 'results.json', render_legacy(m, inputs, work))
            print('기존 PDF·Excel: private/compare/legacy/')
        else:
            print('private/fonts 가 없어 기존 PDF·Excel 생성은 건너뜀')
    print('완료: tests/golden/, tests/fixtures/')


if __name__ == '__main__':
    main()
