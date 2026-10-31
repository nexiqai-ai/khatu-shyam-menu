# Khatu Shyam Vaishno Dhaba ordering page

Static, mobile-first HTML/CSS/vanilla JavaScript frontend. No build step or dependencies are required. The page reads menu rows from a public n8n endpoint and submits the selected dish names and quantities to the supplied order workflow.

## Connect the existing menu

The order webhook URL was supplied, but a menu-read endpoint was not. Add a GET webhook in n8n that reads the existing **Menu** tab and returns JSON rows containing `Category`, `Item Name`, `Price`, and `Available`. The endpoint should permit browser CORS requests from the GitHub Pages origin. Then set `menuUrl` in `config.js` to its production URL. Supported responses are an array of rows, or an object with an array in `data`, `menu`, or `items`.

The frontend deliberately does not contain a copy of the menu: it must use the live sheet through n8n, so dish names, prices, and availability stay authoritative. `config.js` contains only public endpoint URLs. Keep all Google credentials and private keys inside n8n.

## Order response

The page POSTs the documented JSON shape to `https://khatu-shyam-n8n.app.n8n.cloud/webhook/place-customer-order`. Configure the n8n Respond to Webhook node for JSON and browser CORS. For the confirmation screen to show the actual order details, its successful response should include an order token (`order_token` or `token`) and final amount (`final_amount`, `total`, or `total_amount`). If amount is omitted, the browser displays its estimate; the workflow remains authoritative for the final payable amount.

## Run and host

Open `index.html` directly for the static interface, or serve the `outputs/` folder with any local static server. GitHub Pages can publish the contents of this folder after the menu endpoint is configured and the live flow is checked. No secrets should be added to this folder.
