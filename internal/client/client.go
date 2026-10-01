// Package client talks to the tdm daemon over its local HTTP API.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/lukaszfiszer/tandem/internal/store"
)

type Client struct {
	base, token string
	hc          *http.Client
}

// APIError is an error reported by the daemon (or a failure to reach it) with a recovery hint.
type APIError struct {
	Status  int
	Code    string
	Message string
	Hint    string
}

func (e *APIError) Error() string { return e.Code + ": " + e.Message }

func New(info store.DaemonInfo) *Client {
	return &Client{base: fmt.Sprintf("http://127.0.0.1:%d", info.Port), token: info.Token, hc: &http.Client{}}
}

func (c *Client) BaseURL() string { return c.base }
func (c *Client) Token() string   { return c.token }

// Raw sends a request and returns the status and body without interpreting them.
func (c *Client) Raw(ctx context.Context, method, path string, in any) (int, []byte, error) {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return 0, nil, err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set(store.ClientHeader, store.ClientCLI)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	return resp.StatusCode, data, err
}

// Do sends JSON and decodes a JSON response into out (when non-nil).
func (c *Client) Do(ctx context.Context, method, path string, in, out any) error {
	status, body, err := c.Raw(ctx, method, path, in)
	if err != nil {
		return err
	}
	if status >= 400 {
		return DecodeError(status, body)
	}
	if out != nil && len(body) > 0 {
		return json.Unmarshal(body, out)
	}
	return nil
}

// DecodeError turns a daemon error body {"error":{…}} into *APIError.
func DecodeError(status int, body []byte) error {
	var env struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Hint    string `json:"hint"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &env) != nil || env.Error.Code == "" {
		return &APIError{Status: status, Code: "http_error",
			Message: fmt.Sprintf("daemon returned %d: %s", status, strings.TrimSpace(string(body)))}
	}
	return &APIError{Status: status, Code: env.Error.Code, Message: env.Error.Message, Hint: env.Error.Hint}
}

// Health returns the daemon version, failing fast when nothing answers.
func (c *Client) Health(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	var h struct {
		Version string `json:"version"`
	}
	if err := c.Do(ctx, http.MethodGet, "/health", nil, &h); err != nil {
		return "", err
	}
	return h.Version, nil
}
