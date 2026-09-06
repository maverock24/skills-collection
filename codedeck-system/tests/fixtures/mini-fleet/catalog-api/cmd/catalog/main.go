// Catalog service. Serves item lookups; called by checkout-api and orders-api.
package main

import (
	"fmt"
	"net/http"
)

var prices = map[string]float64{"a1": 9.99, "a2": 19.99}

func itemsHandler(w http.ResponseWriter, r *http.Request) {
	ids := r.URL.Query()["ids"]
	fmt.Fprintf(w, "{\"items\":%v}", ids)
}

func pricesHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Fprint(w, `{"a1":9.99,"a2":19.99}`)
}

func main() {
	http.HandleFunc("/catalog/items", itemsHandler)
	http.HandleFunc("/catalog/prices", pricesHandler)
	http.ListenAndServe(":9090", nil)
}
