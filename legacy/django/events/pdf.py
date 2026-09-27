def _ascii(value):
    return str(value).encode("latin-1", "replace").decode("latin-1")


def _escape(value):
    return _ascii(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _stream(title, subtitle, summary, columns, rows, page_number, pages):
    commands = [
        "0.09 0.23 0.47 rg",
        f"BT /F1 18 Tf 40 805 Td ({_escape(title)}) Tj ET",
        "0.25 0.30 0.38 rg",
        f"BT /F1 10 Tf 40 786 Td ({_escape(subtitle)}) Tj ET",
        f"BT /F1 9 Tf 40 754 Td ({_escape(summary)}) Tj ET",
    ]
    x_positions = [40 + sum(len(column[0]) + 5 for column in columns[:index]) * 4.7 for index in range(len(columns))]
    commands.append("0.08 0.10 0.14 rg")
    for x, (heading, _) in zip(x_positions, columns):
        commands.append(f"BT /F1 8 Tf {x:.1f} 730 Td ({_escape(heading)}) Tj ET")
    commands.append("0.82 0.85 0.90 RG 40 722 m 555 722 l S")
    for row_index, row in enumerate(rows):
        y = 704 - row_index * 15
        commands.append("0.20 0.23 0.28 rg")
        for x, value in zip(x_positions, row):
            commands.append(f"BT /F1 8 Tf {x:.1f} {y} Td ({_escape(value)}) Tj ET")
    commands.extend(
        [
            "0.45 0.48 0.54 rg",
            f"BT /F1 8 Tf 40 32 Td (COT Event Attendance - Page {page_number} of {pages}) Tj ET",
        ]
    )
    return "\n".join(commands).encode("latin-1")


def build_simple_pdf(title, subtitle, summary, columns, rows):
    rows_per_page = 39
    pages = [rows[index : index + rows_per_page] for index in range(0, len(rows), rows_per_page)] or [[]]
    objects = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: None,
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    page_object_numbers = []
    next_number = 4
    for page_number, page_rows in enumerate(pages, 1):
        content_number = next_number
        page_number_ref = next_number + 1
        next_number += 2
        page_object_numbers.append(page_number_ref)
        content = _stream(title, subtitle, summary, columns, page_rows, page_number, len(pages))
        objects[content_number] = (
            f"<< /Length {len(content)} >>\nstream\n".encode("latin-1")
            + content
            + b"\nendstream"
        )
        objects[page_number_ref] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_number} 0 R >>"
        ).encode("latin-1")
    kids = " ".join(f"{number} 0 R" for number in page_object_numbers)
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_object_numbers)} >>".encode("latin-1")

    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number in sorted(objects):
        offsets.append(len(output))
        output.extend(f"{number} 0 obj\n".encode("latin-1"))
        output.extend(objects[number])
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
    output.extend(
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF".encode(
            "latin-1"
        )
    )
    return bytes(output)
