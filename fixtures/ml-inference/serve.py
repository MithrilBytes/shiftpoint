"""Serves the land cover classifier behind a single endpoint."""

import io

import torch
from flask import Flask, jsonify, request
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForImageClassification

MODEL = "eurosat/land-cover-resnet50"

app = Flask(__name__)
processor = AutoImageProcessor.from_pretrained(MODEL)
model = AutoModelForImageClassification.from_pretrained(MODEL)
model.eval()


@app.route("/classify", methods=["POST"])
def classify():
    image = Image.open(io.BytesIO(request.files["tile"].read())).convert("RGB")
    inputs = processor(images=image, return_tensors="pt")

    with torch.no_grad():
        logits = model(**inputs).logits

    index = int(logits.argmax(-1))
    return jsonify({"label": model.config.id2label[index]})


if __name__ == "__main__":
    app.run()
