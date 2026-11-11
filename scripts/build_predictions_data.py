"""Build data/subreddits/<subreddit>/predictions.csv from that folder's test_predictions.csv.

test_predictions.csv has each test post's text, its hand label (`actual_label`) and one
`pred_<model>` column per model, but no post id. Each row is matched to the post in the same
folder's posts.json whose title starts the text (and, if several titles match, whose opening
snippet also appears in it).

The output has one row per post and model (format: data/README.md). These are test-set
predictions only, so `split` is "test". They'll be replaced by out-of-fold predictions from
cross_val_predict covering every post (`split` "oof"), in the same columns.

Usage:
    python3 scripts/build_predictions_data.py [subreddit]

subreddit is the folder name under data/subreddits/ (default: kallmann_syndrome).
"""

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUBREDDITS_DIR = ROOT / "data" / "subreddits"
COLUMNS = ["post_id", "model", "poster_type", "post_type", "split"]

# Display names for the `model` column; any other model falls back to a title-cased column name.
MODEL_NAMES = {"logistic_regression": "Logistic Regression", "linear_svm": "Linear SVM"}


def normalize(text):
    return re.sub(r"\s+", " ", text).strip().lower()


def find_post(text, posts):
    text = normalize(text)
    candidates = [p for p in posts if p["title"] and text.startswith(normalize(p["title"]))]
    if len(candidates) > 1:
        candidates = [p for p in candidates if normalize(p.get("snippet", ""))[:40] in text] or candidates
    return candidates[0] if len(candidates) == 1 else None


def main():
    if len(sys.argv) > 2:
        sys.exit(__doc__)
    folder = SUBREDDITS_DIR / (sys.argv[1] if len(sys.argv) == 2 else "kallmann_syndrome")
    posts = json.loads((folder / "posts.json").read_text(encoding="utf-8"))["posts"]

    with (folder / "test_predictions.csv").open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    model_columns = [c for c in rows[0] if c.startswith("pred_")]

    out_rows, unmatched, mismatched = [], [], 0
    for row in rows:
        post = find_post(row["text"], posts)
        if post is None or not post.get("id"):
            unmatched.append(row["text"][:80])
            continue
        if row["actual_label"] not in post["what"]:
            mismatched += 1
        for column in model_columns:
            model_id = column[len("pred_"):]
            out_rows.append({
                "post_id": post["id"],
                "model": MODEL_NAMES.get(model_id, model_id.replace("_", " ").title()),
                "poster_type": "",  # these models only predict the post type
                "post_type": row[column],
                "split": "test",
            })

    out_path = folder / "predictions.csv"
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(out_rows)

    print(f"Wrote {len(out_rows)} rows ({len(rows) - len(unmatched)} posts x {len(model_columns)} models) "
          f"to {out_path.relative_to(ROOT)}")
    if mismatched:
        print(f"NOTE: {mismatched} rows' actual_label isn't among the post's hand labels in posts.json")
    if unmatched:
        print(f"WARNING: {len(unmatched)} rows had no matching post and were skipped:")
        for text in unmatched:
            print("  ", text)


if __name__ == "__main__":
    main()
