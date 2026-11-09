var requestButton = document.getElementById("request-button");
if (requestButton) {
  requestButton.addEventListener("click", function() {
    document.getElementById("request-message").textContent = "Demo request noted. In a real project, this would be sent to the donor.";
  });
}
