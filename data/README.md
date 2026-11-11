# Dashboard data

The dashboard reads everything from this folder when the page loads. Adding a community
(subreddit) only takes data files: no code changes.

```
data/
  subreddits.json                  list of communities shown in the dropdown
  subreddits/
    kallmann_syndrome/
      posts.json                   required
      predictions.csv              optional: model labels (Hand | Model, Agreement, Actual vs. Predicted)
      post_map.csv                 optional: Post Map coordinates
      comments.json                optional: the Comments view and "View comments" links
      test_predictions.csv         source for predictions.csv (not read by the page)
    XXY/                           add the same files here
```

The page loads its data with `fetch`, so serve it (`python3 -m http.server`) instead of opening
`index.html` directly.

## Adding a community, for example r/XXY

1. Create the folder `data/subreddits/XXY/`. The folder name must match `name` in step 3 exactly
   (case matters).
2. Add `posts.json` to it. Add `predictions.csv`, `post_map.csv` and `comments.json` if you have
   them (formats below). Sections whose file is missing say "Not available yet."
3. In `data/subreddits.json`, set `"ready": true` on its entry (or add an entry if it isn't listed):

   ```json
   {"name": "XXY", "display_name": "r/XXY", "ready": true, "predictions": true, "post_map": true, "comments": false}
   ```

   | Field          | Meaning                                                                   |
   |----------------|---------------------------------------------------------------------------|
   | `name`         | Folder name under `data/subreddits/`                                      |
   | `display_name` | Shown in the dropdown, subtitles and the Compare Communities table        |
   | `ready`        | `false` lists it as "(coming soon)" and disabled; `true` loads its files |
   | `predictions`  | `true` if the folder has `predictions.csv`; leave it out or `false` otherwise |
   | `post_map`     | `true` if the folder has `post_map.csv`; leave it out or `false` otherwise |
   | `comments`     | `true` if the folder has `comments.json`; leave it out or `false` otherwise |

   The first ready community in the list is the one shown when the page opens.
4. Reload the page. The new community appears in the dropdown, and Compare Communities shows
   it side by side with the others. If a file is missing or broken, a red message under the
   page title says which one.

## posts.json

```json
{
  "range": {"start": "2016-02-01", "end": "2026-09-30"},
  "who_order": ["Patient", "Researcher", "Advocate", "Family Member", "Doctor", "Unknown"],
  "what_order": ["Sharing Info", "Seeking Info", "Asking for Opinions", "Research"],
  "posts": [
    {"id": "44k46b", "date": "2016-02-07", "who": "Patient", "what": ["Sharing Info"], "title": "An apology", "snippet": "Sorry to everyone...", "score": 2, "comments": 0, "url": "https://www.reddit.com/r/kallmann_syndrome/comments/44k46b/an_apology/"}
  ]
}
```

| Field        | Required | Meaning                                                                                              |
|--------------|----------|------------------------------------------------------------------------------------------------------|
| `range`      | no       | Period the data covers, `YYYY-MM-DD`. Defaults to the first and last post dates.                     |
| `who_order`  | no       | Poster types in legend and color order. Defaults to the order they first appear in `posts`.          |
| `what_order` | no       | Post types in legend and color order. Defaults to the order they first appear in `posts`.            |
| `posts`      | yes      | One object per post, in any order (the page sorts them by date).                                     |

Each post:

| Field      | Required | Meaning                                                                                     |
|------------|----------|---------------------------------------------------------------------------------------------|
| `id`       | no       | Reddit's post id, the part after `/comments/` in the link (`44k46b`). Comments link to posts by it. If left out, it's read from `url`. |
| `date`     | yes      | `YYYY-MM-DD`                                                                                |
| `who`      | yes      | Poster type. Use `"Patient"` for patients: the "Patient posters" stat counts that exact value. Use `"Unknown"` when unclear (always shown in gray). |
| `what`     | yes      | List of post types, usually one, for example `["Seeking Info"]`                            |
| `title`    | yes      | Post title (may be `""`)                                                                    |
| `snippet`  | no       | Short excerpt shown under the title                                                         |
| `score`    | no       | Reddit score (number)                                                                       |
| `comments` | no       | Reddit comment count (number). If any post lacks it, the second stat card shows "Test posts" instead of "Comments". |
| `url`      | no       | Reddit link. Only `https://www.reddit.com/...` links are made clickable.                    |

## predictions.csv (optional)

Model labels, one row per post and model. They feed the Hand | Model toggle, the Agreement
section (Hand vs. Model), "Show disagreements only" in the posts list, the Post Map's "Model
label" coloring and the Actual vs. Predicted chart. Set `"predictions": true` on the community
in `data/subreddits.json` when you add this file.

```csv
post_id,model,poster_type,post_type,split
1g7d12t,Logistic Regression,,Asking for Opinions,test
1g7d12t,Linear SVM,,Seeking Info,test
```

| Column        | Meaning                                                                                       |
|---------------|-----------------------------------------------------------------------------------------------|
| `post_id`     | The post's `id` in `posts.json`. Rows for other ids are skipped.                              |
| `model`       | Model name as shown in the dropdowns, e.g. `Logistic Regression`                              |
| `poster_type` | Predicted poster type, using the same names as `who`. Leave empty if the model doesn't predict it. |
| `post_type`   | Predicted post type, using the same names as `what`. Leave empty if the model doesn't predict it. |
| `split`       | `oof` for out-of-fold (cross-validated) predictions, `test` for held-out test-set predictions |

Posts without a row keep their hand labels everywhere. A field no row fills in (right now,
`poster_type`) shows "Not available yet." in the Model view and in Agreement. When a post has
several hand post types, it agrees with the model if the model picked any of them.

**This file is temporary.** It currently holds the test-set predictions from
`test_predictions.csv` (105 posts, `split` = `test`), built by `scripts/build_predictions_data.py`.
It will be replaced by out-of-fold predictions from scikit-learn's `cross_val_predict` covering
every post (`split` = `oof`), in the same columns. Agreement states which kind it's based on.

## post_map.csv (optional)

2-D coordinates for the Post Map, one row per post. Set `"post_map": true` on the community in
`data/subreddits.json` when you add this file.

```csv
post_id,x,y,topic_id,method
44k46b,-3.428,-2.413,,tfidf-tsne
```

| Column     | Meaning                                                                                 |
|------------|-----------------------------------------------------------------------------------------|
| `post_id`  | The post's `id` in `posts.json`                                                         |
| `x`, `y`   | Coordinates (any scale; the axes aren't shown)                                          |
| `topic_id` | BERTopic topic number (`-1` for outliers). Leave empty until topics exist: "Color by: BERTopic topic" stays disabled while every row is empty. |
| `method`   | How the layout was made, shown under the map: `tfidf-tsne` reads "TF-IDF + t-SNE (temporary)", `sbert-umap` reads "SBERT + UMAP"; other values are shown as written. |

**The current file is temporary.** `scripts/build_post_map.py` made it from each post's title and
snippet with TF-IDF, TruncatedSVD and t-SNE (`method` = `tfidf-tsne`). It will be replaced by the
modeling team's SBERT + UMAP coordinates (`method` = `sbert-umap`) with BERTopic topic ids, in
the same columns.

## comments.json (optional)

Set `"comments": true` on the community in `data/subreddits.json` when you add this file. It
fills the Comments side of the Posts | Comments toggle and adds a "View comments" link under
each post that has comments here.

```json
{
  "comments": [
    {"id": "czq1ab2", "post_id": "44k46b", "parent_id": null, "date": "2016-02-08", "body": "Thanks for setting this up.", "score": 3, "who": "Patient", "what": ["Sharing Info"]},
    {"id": "czq7cd4", "post_id": "44k46b", "parent_id": "czq1ab2", "date": "2016-02-09", "body": "Agreed!", "score": 1}
  ]
}
```

One object per comment, in any order:

| Field       | Required | Meaning                                                                                       |
|-------------|----------|-----------------------------------------------------------------------------------------------|
| `id`        | yes      | Reddit's comment id. Replies point to it.                                                     |
| `post_id`   | yes      | The `id` of the post it belongs to in `posts.json`. Comments on posts that aren't there are skipped. |
| `parent_id` | no       | `id` of the comment this one replies to. `null` or left out for a direct reply to the post.  |
| `date`      | yes      | `YYYY-MM-DD`                                                                                  |
| `body`      | yes      | Comment text (plain text; long comments are shortened in the Comments list)                   |
| `score`     | no       | Reddit score (number)                                                                         |
| `who`       | no       | Commenter type, same values as posts' `who` (`"Patient"` feeds the "Patient commenters" stat) |
| `what`      | no       | List of comment types, like posts' `what`                                                     |

What the Comments view shows:

- **Stat cards, Comments per Month and the Comments list** work from `id`, `post_id` and `date` alone.
- **Commenter Type** and **Patient commenters** need `who` on the comments, and **Comment Type** needs `what`.
  Without them, those parts say "Not available for comments yet."
- **Actual vs. Predicted** is for posts only and always says "Not available for comments yet."
- A community without `comments.json` says "Not available for comments yet." in every section.

## Building the files with the scripts

The last argument is always the folder name under `data/subreddits/`.

```bash
# posts.json, from a health-social-media-viz index.html
python3 scripts/build_posts_data.py /path/to/viz/index.html XXY

# predictions.csv, from data/subreddits/XXY/test_predictions.csv
# (columns: text, actual_label, pred_<model>...; rows are matched to posts.json by title)
python3 scripts/build_predictions_data.py XXY

# post_map.csv (temporary TF-IDF + t-SNE layout); needs scikit-learn
pip install -r scripts/requirements.txt
python3 scripts/build_post_map.py XXY
```

There's no script for `comments.json` yet. Otherwise, write the files in the formats above any
way you like.
