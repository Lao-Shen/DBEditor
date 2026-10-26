package main

import (
	"crypto/x509"
	"encoding/pem"
	"testing"
)

// 内置更新公钥是签名验签的唯一信任根，若格式非法则整个更新校验失效。
func TestUpdaterPublicKeyIsValidPKIX(t *testing.T) {
	block, _ := pem.Decode(updaterPublicKey)
	if block == nil {
		t.Fatal("updater.pub 不是合法的 PEM")
	}
	if _, err := x509.ParsePKIXPublicKey(block.Bytes); err != nil {
		t.Fatalf("updater.pub 不是合法的 PKIX 公钥: %v", err)
	}
}
