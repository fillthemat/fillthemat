const messages: Record<string, string> = {
  passed: "Domain verified.",
  no_redirect:
    "No redirect or JSON copy was found. Redirect the well-known URL to the target shown here, or host the downloaded file.",
  non_https:
    "Every redirect must use HTTPS. Change the non-HTTPS hop and check again.",
  wrong_destination:
    "The redirect has the wrong destination. Use this School's exact discovery URL, including the domain.",
  copy_mismatch:
    "The hosted copy does not match. Upload the downloaded poppy.json exactly, with application/json content type.",
  claimed_by_another_school:
    "This domain is already verified for another School. It must be removed there before you can claim it.",
  unsafe_destination:
    "This domain or a redirect points to a private or unsafe network address. Use a public HTTPS website.",
  too_many_redirects:
    "There are too many redirects (maximum 5). Shorten the redirect chain.",
  invalid_redirect:
    "A redirect is missing a valid destination. Fix its Location header.",
  redirects_disallowed: "Redirects are not allowed for this document.",
  too_large:
    "The response is too large (maximum 64 KiB). Serve only the discovery file.",
  timeout:
    "The website took too long to respond. Try again after checking that it is available.",
  fetch_failed:
    "We could not reach the website over valid HTTPS. Check its DNS, certificate and availability.",
  http_error:
    "The website did not return HTTP 200. Make the well-known URL available and check again.",
  not_found:
    "This domain was removed or the check expired. Refresh the page and try again.",
  check_in_progress:
    "A check is already running. Wait a moment, then try again.",
};

export function domainCheckMessage(result: string): string {
  return (
    messages[result] ??
    "The domain check failed. Check your website setup and try again."
  );
}
