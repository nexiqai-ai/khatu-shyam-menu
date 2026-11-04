# Khatu Shyam Vaishno Dhaba ordering website

Static, mobile-first ordering page built with HTML, CSS, and vanilla JavaScript. It has no build step or external runtime dependencies.

## Development n8n endpoints

The public URLs are set in `config.js`:

- Menu GET: `https://lovedeep-automates.app.n8n.cloud/webhook/21593612-35d3-4aae-b021-b66c96323ad7`
- Order POST: `https://lovedeep-automates.app.n8n.cloud/webhook/8f0f5ebc-c691-496f-9a15-b6a89b540409`

These production-style webhook URLs belong to the three DEV workflows and use only the `Khatu Shyam Development Test` spreadsheet. Activate the DEV workflows only while testing. The production workflows and production sheet remain untouched. `config.js` contains public endpoint URLs only; keep credentials and private keys inside n8n.

## Order request and confirmation response

The website keeps the existing request body:

```json
{
  "customer_name": "Customer Name",
  "phone": "9876543210",
  "items": [
    { "item_name": "Dal Makhani", "quantity": 1 }
  ]
}
```

The frontend only displays successful confirmation for an HTTP-success response with this JSON contract:

```json
{
  "success": true,
  "order_token": "KSV-123456",
  "total_amount": 480,
  "payment_status": "Pending"
}
```

`total_amount` must be a finite JSON number, `order_token` a non-empty string, and `payment_status` a non-empty string. The frontend also requires HTTP success and `success: true`. It never creates a token or substitutes the estimated cart total as the confirmed amount. A generic webhook response such as `Workflow was started` is treated as an unconfirmed order and prompts the customer to check with the cashier before trying again.

The n8n customer-order workflow must return that JSON only after durable order and line-item persistence succeeds. Do not publish the site until the dummy-order lifecycle has passed.

## Run locally

From the repository root, run Python's built-in server:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/`. A local HTTP origin is preferable to opening the page with `file://` for testing cross-origin requests.

This checkout is a development candidate. Keep it on a development branch until the backend endpoints and end-to-end dummy-order tests are verified. Do not merge to `main`, push to the production deployment branch, publish GitHub Pages, or use the production page for dummy orders without explicit approval.
