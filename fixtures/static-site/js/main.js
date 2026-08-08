// Marks the current page in the nav. That is the whole of the JavaScript.
document.addEventListener("DOMContentLoaded", function () {
  var here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("nav a").forEach(function (link) {
    if (link.getAttribute("href") === here) {
      link.setAttribute("aria-current", "page");
    }
  });
});
