from pathlib import Path
import subprocess
import zipfile

import pytest

from ats_async.extract import ResumeTextExtractor, ResumeTextExtractionError


def write_docx(path: Path, text: str) -> None:
    document_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>{text}</w:t></w:r></w:p>
      </w:body>
    </w:document>'''
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("word/document.xml", document_xml)
        zf.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')


def test_extract_plain_text_file(tmp_path: Path):
    file_path = tmp_path / "resume.txt"
    file_path.write_text("Hello\nWorld\n", encoding="utf-8")

    text = ResumeTextExtractor().extract(file_path)

    assert text == "Hello\nWorld"


def test_extract_docx_file(tmp_path: Path):
    file_path = tmp_path / "resume.docx"
    write_docx(file_path, "Senior Python Engineer")

    text = ResumeTextExtractor().extract(file_path)

    assert "Senior Python Engineer" in text


def test_extract_pdf_uses_pdftotext(monkeypatch, tmp_path: Path):
    file_path = tmp_path / "resume.pdf"
    file_path.write_bytes(b"%PDF-1.4\n")

    called = {}

    def fake_run(cmd, check, capture_output, text):
        called["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="PDF extracted text\n", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    text = ResumeTextExtractor().extract(file_path)

    assert text == "PDF extracted text"
    assert called["cmd"][0] == "pdftotext"


def test_extract_unsupported_file_type_raises(tmp_path: Path):
    file_path = tmp_path / "resume.bin"
    file_path.write_bytes(b"\x00\x01")

    with pytest.raises(ResumeTextExtractionError):
        ResumeTextExtractor().extract(file_path)
