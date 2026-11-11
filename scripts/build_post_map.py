"""Build data/subreddits/<subreddit>/post_map.csv: 2-D coordinates for the Post Map.

TEMPORARY LAYOUT. Each post's title and snippet are turned into TF-IDF vectors, reduced with
TruncatedSVD, then laid out in 2-D with t-SNE (scikit-learn). Rows are written with
method "tfidf-tsne". The modeling team's SBERT + UMAP coordinates (method "sbert-umap", and
BERTopic topic ids in topic_id) replace this file later, in the same columns:

    post_id,x,y,topic_id,method

topic_id is left empty here, so "Color by: BERTopic topic" stays disabled until it's filled.

Needs scikit-learn (pip install -r scripts/requirements.txt).

Usage:
    python3 scripts/build_post_map.py [subreddit]

subreddit is the folder name under data/subreddits/ (default: kallmann_syndrome).
"""

import csv
import json
import sys
from pathlib import Path

try:
    from sklearn.decomposition import TruncatedSVD
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.manifold import TSNE
except ImportError:
    sys.exit("This script needs scikit-learn: pip install -r scripts/requirements.txt")

ROOT = Path(__file__).resolve().parent.parent
SUBREDDITS_DIR = ROOT / "data" / "subreddits"
METHOD = "tfidf-tsne"
SEED = 42  # fixed, so re-running gives the same layout


def main():
    if len(sys.argv) > 2:
        sys.exit(__doc__)
    folder = SUBREDDITS_DIR / (sys.argv[1] if len(sys.argv) == 2 else "kallmann_syndrome")
    posts = [p for p in json.loads((folder / "posts.json").read_text(encoding="utf-8"))["posts"] if p.get("id")]
    if len(posts) < 10:
        sys.exit(f"Only {len(posts)} posts with an id in {folder / 'posts.json'}: too few for a map")

    texts = [f"{p.get('title', '')} {p.get('snippet', '')}" for p in posts]
    tfidf = TfidfVectorizer(stop_words="english", sublinear_tf=True, min_df=2).fit_transform(texts)
    reduced = TruncatedSVD(n_components=min(50, tfidf.shape[1] - 1), random_state=SEED).fit_transform(tfidf)
    perplexity = min(30, (len(posts) - 1) / 3)
    coords = TSNE(n_components=2, perplexity=perplexity, init="pca", random_state=SEED).fit_transform(reduced)

    out_path = folder / "post_map.csv"
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["post_id", "x", "y", "topic_id", "method"])
        for post, (x, y) in zip(posts, coords):
            writer.writerow([post["id"], f"{x:.3f}", f"{y:.3f}", "", METHOD])

    print(f"Wrote {len(posts)} points to {out_path.relative_to(ROOT)} (method {METHOD})")
    print('Set "post_map": true for this community in data/subreddits.json if it isn\'t already.')


if __name__ == "__main__":
    main()
