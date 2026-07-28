<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

function env_config(): array
{
    $config = [
        'DB_HOST' => 'localhost',
        'DB_USER' => 'root',
        'DB_PASSWORD' => '',
        'DB_NAME' => 'gkpi_pekanbaru',
    ];

    $envPath = __DIR__ . DIRECTORY_SEPARATOR . '.env';
    if (!is_file($envPath)) {
        return $config;
    }

    foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $config[trim($key)] = trim($value);
    }

    return $config;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = env_config();
    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=utf8mb4',
        $config['DB_HOST'] ?? 'localhost',
        $config['DB_NAME'] ?? 'gkpi_pekanbaru'
    );

    $pdo = new PDO($dsn, $config['DB_USER'] ?? 'root', $config['DB_PASSWORD'] ?? '', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

function json_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function respond($data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(Throwable $error, int $status = 500): void
{
    respond(['error' => $error->getMessage()], $status);
}

function format_date($value): string
{
    if (!$value) {
        return '';
    }
    $time = strtotime((string) $value);
    return $time ? date('Y-m-d', $time) : '';
}

function null_if_empty($value)
{
    if ($value === null) {
        return null;
    }
    $value = trim((string) $value);
    return $value === '' ? null : $value;
}

function member_from_row(array $row): array
{
    return [
        'id' => $row['id'],
        'number' => $row['no_jemaat'],
        'name' => $row['nama'],
        'status' => $row['status_keluarga'],
        'gender' => $row['jenis_kelamin'],
        'address' => $row['alamat'],
        'sector' => $row['sektor_nama'],
        'birthDate' => format_date($row['tanggal_lahir']),
        'baptismDate' => format_date($row['tanggal_baptis']),
        'confirmationDate' => format_date($row['tanggal_sidi']),
        'marriageDate' => format_date($row['tanggal_nikah']),
        'familyId' => $row['family_id'],
        'enteredAt' => $row['entered_at'] ? date(DATE_ATOM, strtotime($row['entered_at'])) : '',
    ];
}

function left_member_from_row(array $row): array
{
    $member = member_from_row($row);
    $member['leftId'] = $row['id'];
    $member['reason'] = $row['status_keanggotaan'];
    $member['leftDate'] = format_date($row['tanggal_keluar']);
    $member['notes'] = $row['catatan_keluar'] ?? '';
    return $member;
}

function status_rank(?string $status): int
{
    $value = strtolower(trim((string) $status));
    if (str_contains($value, 'kepala')) {
        return 1;
    }
    if (str_contains($value, 'istri')) {
        return 2;
    }
    if (str_contains($value, 'anak')) {
        return 3;
    }
    if (str_contains($value, 'family lain')) {
        return 4;
    }
    return 9;
}

function compare_members_for_export(array $a, array $b): int
{
    $numberCompare = strnatcasecmp((string) ($a['no_jemaat'] ?? ''), (string) ($b['no_jemaat'] ?? ''));
    if ($numberCompare !== 0) {
        return $numberCompare;
    }

    $statusCompare = status_rank($a['status_keluarga'] ?? null) <=> status_rank($b['status_keluarga'] ?? null);
    if ($statusCompare !== 0) {
        return $statusCompare;
    }

    return strcasecmp((string) ($a['nama'] ?? ''), (string) ($b['nama'] ?? ''));
}

function xml_text($value): string
{
    return htmlspecialchars((string) ($value ?? ''), ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

function sanitize_sheet_name(string $name): string
{
    $name = preg_replace('/[\\[\\]\\*\\/?\\\\:]/u', ' ', $name) ?? $name;
    $name = str_replace("'", '', $name);
    $name = trim($name);
    if ($name === '') {
        $name = 'Sheet1';
    }
    return substr($name, 0, 31);
}

function sanitize_filename(string $name): string
{
    $name = preg_replace('/[^A-Za-z0-9._-]+/u', '-', $name) ?? $name;
    $name = trim($name, '-_.');
    return $name === '' ? 'database-jemaat' : strtolower($name);
}

function column_letter(int $index): string
{
    $index += 1;
    $letters = '';
    while ($index > 0) {
        $remainder = ($index - 1) % 26;
        $letters = chr(65 + $remainder) . $letters;
        $index = intdiv($index - 1, 26);
    }
    return $letters;
}

function build_shared_strings(array $headers, array $rows): array
{
    $unique = [];
    $map = [];
    $totalCount = 0;

    $push = static function ($value) use (&$unique, &$map): int {
        $text = (string) ($value ?? '');
        if (array_key_exists($text, $map)) {
            return $map[$text];
        }
        $map[$text] = count($unique);
        $unique[] = $text;
        return $map[$text];
    };

    $headerIndexes = [];
    foreach ($headers as $header) {
        $headerIndexes[] = $push($header);
        $totalCount += 1;
    }
    $rowsIndexes = [];
    foreach ($rows as $row) {
        $indexedRow = [];
        foreach ($row as $value) {
            $indexedRow[] = $push($value);
            $totalCount += 1;
        }
        $rowsIndexes[] = $indexedRow;
    }

    return [$unique, array_merge([$headerIndexes], $rowsIndexes), $totalCount];
}

function build_sheet_xml(array $headers, array $rows, array $stringIndexes): string
{
    $allRows = array_merge([$headers], $rows);
    $lastColumn = column_letter(max(count($headers) - 1, 0));
    $lastRow = max(count($allRows), 1);

    $colWidths = [];
    foreach ($headers as $index => $header) {
        $width = strlen((string) $header);
        foreach ($rows as $row) {
            $width = max($width, strlen((string) ($row[$index] ?? '')));
        }
        $colWidths[] = min($width + 2, 36);
    }

    $colsXml = '';
    foreach ($colWidths as $index => $width) {
        $colNumber = $index + 1;
        $colsXml .= sprintf('<col min="%1$d" max="%1$d" width="%2$s" customWidth="1"/>', $colNumber, $width);
    }

    $rowsXml = '';
    foreach ($allRows as $rowIndex => $row) {
        $cells = '';
        foreach ($row as $colIndex => $value) {
            $cellRef = column_letter($colIndex) . ($rowIndex + 1);
            $style = $rowIndex === 0 ? ' s="1"' : '';
            $idx = (int) ($stringIndexes[$rowIndex][$colIndex] ?? 0);
            $cells .= sprintf('<c r="%s"%s t="s"><v>%d</v></c>', $cellRef, $style, $idx);
        }
        $rowsXml .= sprintf('<row r="%1$d">%2$s</row>', $rowIndex + 1, $cells);
    }

    return <<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:{$lastColumn}{$lastRow}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>{$colsXml}</cols>
  <sheetData>{$rowsXml}</sheetData>
  <autoFilter ref="A1:{$lastColumn}{$lastRow}"/>
</worksheet>
XML;
}

function build_shared_strings_xml(array $strings, int $totalCount): string
{
    $uniqueCount = count($strings);
    $items = '';
    foreach ($strings as $value) {
        $items .= '<si><t xml:space="preserve">' . xml_text($value) . '</t></si>';
    }

    return <<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{$totalCount}" uniqueCount="{$uniqueCount}">
  {$items}
</sst>
XML;
}

function build_xlsx_bytes(array $headers, array $rows, string $sheetName = 'Database Jemaat'): string
{
    $sheetName = sanitize_sheet_name($sheetName);
    [$strings, $indexedRows, $totalCount] = build_shared_strings($headers, $rows);
    $sheetXml = build_sheet_xml($headers, $rows, $indexedRows);
    $sharedStringsXml = build_shared_strings_xml($strings, $totalCount);

    $tmpPath = tempnam(sys_get_temp_dir(), 'gkpi_xlsx_');
    if ($tmpPath === false) {
        throw new RuntimeException('Gagal menyiapkan file sementara.');
    }

    $zip = new ZipArchive();
    if ($zip->open($tmpPath, ZipArchive::OVERWRITE | ZipArchive::CREATE) !== true) {
        @unlink($tmpPath);
        throw new RuntimeException('Gagal membuat arsip Excel.');
    }

    $zip->addFromString('[Content_Types].xml', <<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>
XML);
    $zip->addFromString('_rels/.rels', <<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
XML);
    $zip->addFromString('docProps/core.xml', <<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>GKPI</dc:creator>
  <cp:lastModifiedBy>GKPI</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-07-14T00:00:00Z</dcterms:created>
</cp:coreProperties>
XML);
    $zip->addFromString('docProps/app.xml', <<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Excel</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>1</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="1" baseType="lpstr">
      <vt:lpstr>{$sheetName}</vt:lpstr>
    </vt:vector>
  </TitlesOfParts>
  <Company>GKPI</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>
XML);
    $zip->addFromString('xl/workbook.xml', sprintf(<<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr/>
  <bookViews>
    <workbookView activeTab="0"/>
  </bookViews>
  <sheets>
    <sheet name="%s" sheetId="1" r:id="rId1"/>
  </sheets>
  <calcPr calcId="124519"/>
</workbook>
XML, xml_text($sheetName)));
    $zip->addFromString('xl/_rels/workbook.xml.rels', <<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>
XML);
    $zip->addFromString('xl/styles.xml', <<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD9E2F3"/></left>
      <right style="thin"><color rgb="FFD9E2F3"/></right>
      <top style="thin"><color rgb="FFD9E2F3"/></top>
      <bottom style="thin"><color rgb="FFD9E2F3"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>
XML);
    $zip->addFromString('xl/sharedStrings.xml', $sharedStringsXml);
    $zip->addFromString('xl/worksheets/sheet1.xml', $sheetXml);
    $zip->addFromString('xl/theme/theme1.xml', <<<XML
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F497D"/></a:dk2>
      <a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
      <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
      <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
      <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
      <a:accent6><a:srgbClr val="F79646"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont>
        <a:latin typeface="Cambria"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
        <a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/>
        <a:font script="Hang" typeface="맑은 고딕"/>
        <a:font script="Hans" typeface="宋体"/>
        <a:font script="Hant" typeface="新細明體"/>
        <a:font script="Arab" typeface="Times New Roman"/>
        <a:font script="Hebr" typeface="Times New Roman"/>
        <a:font script="Thai" typeface="Tahoma"/>
        <a:font script="Ethi" typeface="Nyala"/>
        <a:font script="Beng" typeface="Vrinda"/>
        <a:font script="Gujr" typeface="Shruti"/>
        <a:font script="Khmr" typeface="MoolBoran"/>
        <a:font script="Knda" typeface="Tunga"/>
        <a:font script="Guru" typeface="Raavi"/>
        <a:font script="Cans" typeface="Euphemia"/>
        <a:font script="Cher" typeface="Plantagenet Cherokee"/>
        <a:font script="Yiii" typeface="Microsoft Yi Baiti"/>
        <a:font script="Tibt" typeface="Microsoft Himalaya"/>
        <a:font script="Thaa" typeface="MV Boli"/>
        <a:font script="Deva" typeface="Mangal"/>
        <a:font script="Telu" typeface="Gautami"/>
        <a:font script="Taml" typeface="Latha"/>
        <a:font script="Syrc" typeface="Estrangelo Edessa"/>
        <a:font script="Orya" typeface="Kalinga"/>
        <a:font script="Mlym" typeface="Kartika"/>
        <a:font script="Laoo" typeface="DokChampa"/>
        <a:font script="Sinh" typeface="Iskoola Pota"/>
        <a:font script="Mong" typeface="Mongolian Baiti"/>
        <a:font script="Viet" typeface="Times New Roman"/>
        <a:font script="Uigh" typeface="Microsoft Uighur"/>
        <a:font script="Geor" typeface="Sylfaen"/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Calibri"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
        <a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/>
        <a:font script="Hang" typeface="맑은 고딕"/>
        <a:font script="Hans" typeface="宋体"/>
        <a:font script="Hant" typeface="新細明體"/>
        <a:font script="Arab" typeface="Arial"/>
        <a:font script="Hebr" typeface="Arial"/>
        <a:font script="Thai" typeface="Tahoma"/>
        <a:font script="Ethi" typeface="Nyala"/>
        <a:font script="Beng" typeface="Vrinda"/>
        <a:font script="Gujr" typeface="Shruti"/>
        <a:font script="Khmr" typeface="DaunPenh"/>
        <a:font script="Knda" typeface="Tunga"/>
        <a:font script="Guru" typeface="Raavi"/>
        <a:font script="Cans" typeface="Euphemia"/>
        <a:font script="Cher" typeface="Plantagenet Cherokee"/>
        <a:font script="Yiii" typeface="Microsoft Yi Baiti"/>
        <a:font script="Tibt" typeface="Microsoft Himalaya"/>
        <a:font script="Thaa" typeface="MV Boli"/>
        <a:font script="Deva" typeface="Mangal"/>
        <a:font script="Telu" typeface="Gautami"/>
        <a:font script="Taml" typeface="Latha"/>
        <a:font script="Syrc" typeface="Estrangelo Edessa"/>
        <a:font script="Orya" typeface="Kalinga"/>
        <a:font script="Mlym" typeface="Kartika"/>
        <a:font script="Laoo" typeface="DokChampa"/>
        <a:font script="Sinh" typeface="Iskoola Pota"/>
        <a:font script="Mong" typeface="Mongolian Baiti"/>
        <a:font script="Viet" typeface="Arial"/>
        <a:font script="Uigh" typeface="Microsoft Uighur"/>
        <a:font script="Geor" typeface="Sylfaen"/>
      </a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>
XML);

    $zip->close();

    $bytes = file_get_contents($tmpPath);
    @unlink($tmpPath);

    if ($bytes === false) {
        throw new RuntimeException('Gagal membaca file Excel sementara.');
    }

    return $bytes;
}

try {
    $pdo = db();
    $pdo->exec("UPDATE jemaat SET status_keanggotaan = 'Aktif' WHERE status_keanggotaan IS NULL");

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $pathInfo = $_SERVER['PATH_INFO'] ?? '';
    $path = trim($pathInfo, '/');
    $parts = $path === '' ? [] : explode('/', $path);

    if ($method === 'GET' && ($path === 'health' || $path === '')) {
        respond(['ok' => true]);
    }

    if ($method === 'GET' && $path === 'sectors') {
        $rows = $pdo->query('SELECT nama FROM sektor ORDER BY id')->fetchAll();
        respond(array_column($rows, 'nama'));
    }

    if ($method === 'GET' && $path === 'members') {
        $sql = "SELECT * FROM jemaat WHERE (status_keanggotaan = 'Aktif' OR status_keanggotaan IS NULL)";
        $params = [];
        if (isset($_GET['sector']) && $_GET['sector'] !== 'all') {
            $sql .= ' AND sektor_nama = ?';
            $params[] = $_GET['sector'];
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        respond(array_map('member_from_row', $stmt->fetchAll()));
    }

    if ($method === 'GET' && $path === 'new-members') {
        $rows = $pdo
            ->query("SELECT * FROM jemaat WHERE (status_keanggotaan = 'Aktif' OR status_keanggotaan IS NULL) AND entered_at >= NOW() - INTERVAL 30 DAY")
            ->fetchAll();
        respond(array_map('member_from_row', $rows));
    }

    if ($method === 'GET' && $path === 'left-members') {
        $rows = $pdo
            ->query("SELECT * FROM jemaat WHERE status_keanggotaan IN ('Pindah', 'Meninggal')")
            ->fetchAll();
        respond(array_map('left_member_from_row', $rows));
    }

    if ($method === 'GET' && $path === 'download-members-xlsx') {
        $sql = "SELECT * FROM jemaat WHERE (status_keanggotaan = 'Aktif' OR status_keanggotaan IS NULL)";
        $params = [];
        if (isset($_GET['sector']) && $_GET['sector'] !== 'all') {
            $sql .= ' AND sektor_nama = ?';
            $params[] = $_GET['sector'];
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        usort($rows, 'compare_members_for_export');

        $headers = ['No. Jemaat', 'Nama', 'Status', 'Jenis Kelamin', 'Alamat', 'Sektor', 'Tanggal Lahir', 'Tanggal Baptis', 'Tanggal Sidi', 'Tanggal Nikah'];
        $dataRows = array_map(static function (array $row): array {
            return [
                $row['no_jemaat'] ?? '',
                $row['nama'] ?? '',
                $row['status_keluarga'] ?? '',
                $row['jenis_kelamin'] ?? '',
                $row['alamat'] ?? '',
                $row['sektor_nama'] ?? '',
                format_date($row['tanggal_lahir'] ?? null),
                format_date($row['tanggal_baptis'] ?? null),
                format_date($row['tanggal_sidi'] ?? null),
                format_date($row['tanggal_nikah'] ?? null),
            ];
        }, $rows);

        $xlsx = build_xlsx_bytes($headers, $dataRows, 'Database Jemaat');
        $filenamePart = isset($_GET['sector']) && $_GET['sector'] !== 'all'
            ? sanitize_filename($_GET['sector'])
            : 'semua-sektor';
        $filename = sprintf('%s-data-keluarga-jemaat.xlsx', $filenamePart);

        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . strlen($xlsx));
        echo $xlsx;
        exit;
    }

    if ($method === 'POST' && $path === 'members') {
        $m = json_body();
        $stmt = $pdo->prepare(
            'INSERT INTO jemaat (
                id, no_jemaat, nama, status_keluarga, jenis_kelamin, alamat, sektor_nama,
                tanggal_lahir, tanggal_baptis, tanggal_sidi, tanggal_nikah, family_id, entered_at,
                status_keanggotaan
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $m['id'] ?? '',
            $m['number'] ?? '',
            $m['name'] ?? '',
            $m['status'] ?? 'Aktif',
            $m['gender'] ?? '',
            $m['address'] ?? null,
            $m['sector'] ?? '',
            null_if_empty($m['birthDate'] ?? null),
            null_if_empty($m['baptismDate'] ?? null),
            null_if_empty($m['confirmationDate'] ?? null),
            null_if_empty($m['marriageDate'] ?? null),
            $m['familyId'] ?? '',
            isset($m['enteredAt']) ? date('Y-m-d H:i:s', strtotime((string) $m['enteredAt'])) : date('Y-m-d H:i:s'),
            'Aktif',
        ]);
        $stmt = $pdo->prepare('SELECT * FROM jemaat WHERE id = ?');
        $stmt->execute([$m['id'] ?? '']);
        respond(member_from_row($stmt->fetch()), 201);
    }

    if ($method === 'PUT' && count($parts) === 2 && $parts[0] === 'members') {
        $id = $parts[1];
        $m = json_body();
        $stmt = $pdo->prepare(
            'UPDATE jemaat SET
                no_jemaat = ?, nama = ?, status_keluarga = ?, jenis_kelamin = ?, alamat = ?,
                sektor_nama = ?, tanggal_lahir = ?, tanggal_baptis = ?, tanggal_sidi = ?,
                tanggal_nikah = ?, family_id = ?
             WHERE id = ?'
        );
        $stmt->execute([
            $m['number'] ?? '',
            $m['name'] ?? '',
            $m['status'] ?? null,
            $m['gender'] ?? '',
            $m['address'] ?? null,
            $m['sector'] ?? '',
            null_if_empty($m['birthDate'] ?? null),
            null_if_empty($m['baptismDate'] ?? null),
            null_if_empty($m['confirmationDate'] ?? null),
            null_if_empty($m['marriageDate'] ?? null),
            $m['familyId'] ?? '',
            $id,
        ]);
        $stmt = $pdo->prepare('SELECT * FROM jemaat WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) {
            respond(['error' => 'Member not found'], 404);
        }
        respond(member_from_row($row));
    }

    if ($method === 'DELETE' && count($parts) === 2 && $parts[0] === 'members') {
        $stmt = $pdo->prepare('DELETE FROM jemaat WHERE id = ?');
        $stmt->execute([$parts[1]]);
        if ($stmt->rowCount() === 0) {
            respond(['error' => 'Member not found'], 404);
        }
        respond(['success' => true]);
    }

    if ($method === 'POST' && count($parts) === 3 && $parts[0] === 'members' && $parts[2] === 'leave') {
        $body = json_body();
        $stmt = $pdo->prepare(
            'UPDATE jemaat SET status_keanggotaan = ?, tanggal_keluar = ?, catatan_keluar = ? WHERE id = ?'
        );
        $stmt->execute([
            $body['reason'] ?? '',
            null_if_empty($body['leftDate'] ?? null),
            $body['notes'] ?? null,
            $parts[1],
        ]);
        if ($stmt->rowCount() === 0) {
            respond(['error' => 'Member not found'], 404);
        }
        $stmt = $pdo->prepare('SELECT * FROM jemaat WHERE id = ?');
        $stmt->execute([$parts[1]]);
        respond(left_member_from_row($stmt->fetch()));
    }

    if ($method === 'POST' && $path === 'cleanup-new-history') {
        $stmt = $pdo->prepare(
            "UPDATE jemaat
             SET entered_at = DATE_SUB(NOW(), INTERVAL 31 DAY)
             WHERE (status_keanggotaan = 'Aktif' OR status_keanggotaan IS NULL)
               AND entered_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
        );
        $stmt->execute();
        respond([
            'success' => true,
            'cleared' => $stmt->rowCount(),
            'message' => 'Riwayat anggota baru sudah dibersihkan',
        ]);
    }

    respond(['error' => 'Route not found'], 404);
} catch (Throwable $error) {
    fail($error);
}
