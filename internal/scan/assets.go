package scan

import "fmt"

// assetExtensions are the images, video, audio, fonts, and documents that
// count as weight somebody has to serve. Compared without regard to case, so
// LOGO.PNG counts the same as logo.png.
var assetExtensions = []string{
	".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico", ".bmp", ".tif", ".tiff",
	".mp4", ".webm", ".mov", ".m4v",
	".mp3", ".wav", ".ogg", ".flac",
	".pdf",
	".woff", ".woff2", ".ttf", ".otf", ".eot",
}

// DetectAssets measures the weight of the images, video, audio, fonts, and
// documents checked into the repository. Reported as a raw byte count: the
// threshold that turns bytes into a verdict is a number, and numbers live in
// rules/.
func DetectAssets(repo *Repo) []Signal {
	files := repo.WithExtension(assetExtensions...)

	var total int64
	for _, file := range files {
		total += repo.Bytes(file)
	}

	return []Signal{{
		Field:      FieldAssetBytes,
		Confidence: High,
		Metric:     int(total),
		Evidence:   fmt.Sprintf("%d asset file(s) totalling %d bytes", len(files), total),
	}}
}
