var foodForm = document.getElementById("food-form");
if (foodForm) {
  foodForm.addEventListener("submit", function(event) {
    event.preventDefault();
    var name = document.getElementById("food-name").value;
    var quantity = document.getElementById("food-quantity").value;
    var location = document.getElementById("food-location").value;
    var time = document.getElementById("food-time").value;
    var message = document.getElementById("form-message");
    if (name === "" || quantity === "" || location === "" || time === "") {
      message.textContent = "Please complete all required fields.";
    } else {
      message.textContent = "Preview ready: " + name + " — " + quantity + " at " + location + ", pickup " + time + ". This demo does not save the listing.";
    }
  });
}
