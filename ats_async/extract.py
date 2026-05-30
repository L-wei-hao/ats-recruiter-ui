from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import subprocess
from typing import Union
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile


class ResumeTextExtractionError(RuntimeError):
    pass


@dataclass(slots=True)
class ResumeTextExtractor:
    def extract(self, path: str | Path) -> str:
        file_path = Path(path)
        suffix = file_path.suffix.lower()
        if suffix in {".txt", ".md", ".csv", ".json", ".log"}:
            return self._normalize(file_path.read_text(encoding="utf-8", errors="replace"))
        if suffix == ".pdf" or self._looks_like_pdf(file_path):
            return self._extract_pdf(file_path)
        if suffix == ".docx":
            return self._extract_docx(file_path)
        raise ResumeTextExtractionError(f"Unsupported resume file type: {file_path.suffix or '<none>'}")

    def _extract_pdf(self, file_path: Path) -> str:
        completed = subprocess.run(["pdftotext", "-layout", str(file_path), "-"], check=True, capture_output=True, text=True)
        return self._normalize(completed.stdout)

    def _extract_docx(self, file_path: Path) -> str:
        try:
            with ZipFile(file_path) as archive:
                document = archive.read("word/document.xml")
        except (BadZipFile, KeyError) as exc:
            raise ResumeTextExtractionError(f"Invalid DOCX file: {file_path}") from exc

        root = ET.fromstring(document)
        namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        parts: list[str] = []
        for paragraph in root.findall(".//w:p", namespace):
            text_parts: list[str] = []
            for node in paragraph.iter():
                tag = node.tag.rsplit("}", 1)[-1]
                if tag == "t" and node.text:
                    text_parts.append(node.text)
                elif tag in {"tab", "br", "cr"}:
                    text_parts.append(" ")
            paragraph_text = "".join(text_parts).strip()
            if paragraph_text:
                parts.append(paragraph_text)
        return self._normalize("\n".join(parts))

    def _looks_like_pdf(self, file_path: Path) -> bool:
        try:
            return file_path.read_bytes().startswith(b"%PDF")
        except OSError:
            return False

    def _normalize(self, text: str) -> str:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        lines = [line.rstrip() for line in text.split("\n")]
        while lines and not lines[-1].strip():
            lines.pop()
        while lines and not lines[0].strip():
            lines.pop(0)
        return "\n".join(lines)
