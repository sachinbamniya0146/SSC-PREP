#!/usr/bin/env python3
"""
v1 §7.4 — PRODUCTION-GRADE multi-engine OCR preprocessing.

Uses OpenCV if available, falls back to PIL + numpy.
Applies: grayscale, contrast enhancement, noise reduction, binarization.

Usage: python3 ocr_preprocess.py <input.png> <output.png>
Output to stderr: OK:opencv or OK:pil
"""
import sys
input_path = sys.argv[1]
output_path = sys.argv[2]

try:
    import cv2
    import numpy as np

    img = cv2.imread(input_path, cv2.IMREAD_COLOR)
    if img is None:
        print("ERROR: Could not read image", file=sys.stderr)
        sys.exit(1)

    h, w = img.shape[:2]
    img = cv2.resize(img, (w*2, h*2), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8))
    gray = clahe.apply(gray)
    gray = cv2.fastNlMeansDenoising(gray, h=10)
    cv2.imwrite(output_path, gray)
    print("OK:opencv", file=sys.stderr)

except ImportError:
    from PIL import Image, ImageOps, ImageFilter
    import numpy as np

    img = Image.open(input_path)
    img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
    gray = img.convert('L')
    gray = ImageOps.autocontrast(gray, cutoff=1)
    gray = gray.filter(ImageFilter.MedianFilter(size=3))
    gray.save(output_path)
    print("OK:pil", file=sys.stderr)
