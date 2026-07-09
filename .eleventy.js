const rssPlugin = require("@11ty/eleventy-plugin-rss");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(rssPlugin);

  // Static assets + the custom-domain CNAME
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy("CNAME");

  // One combined, newest-first timeline of notes + posts.
  eleventyConfig.addCollection("writing", (api) =>
    api.getFilteredByTag("writing").sort((a, b) => b.date - a.date)
  );

  eleventyConfig.addFilter("readableDate", (d) =>
    new Date(d).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  );
  eleventyConfig.addFilter("isoDate", (d) => new Date(d).toISOString());

  // Plain text from rendered HTML (full, no truncation) for syndication.
  eleventyConfig.addFilter("plain", (html) =>
    String(html).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
  );

  // Plain-text snippet from rendered HTML (for note titles in the feed).
  eleventyConfig.addFilter("snippet", (html, n = 60) => {
    const text = String(html).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    return text.length > n ? text.slice(0, n).trim() + "…" : text;
  });

  return {
    dir: { input: "src", includes: "_includes", data: "_data", output: "_site" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
};
