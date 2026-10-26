package main

import (
	"context"
	_ "embed"
	"log"
	"net/http"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/endpoint"
)

// currentVersion 当前应用版本号，构建时由
// -ldflags "-X main.currentVersion=x.y.z" 注入；未注入时为 dev
var currentVersion = "dev"

// updaterPublicKey 更新签名验签公钥（PKIX PEM / Ed25519），随客户端编译固定。
// 发布端用对应私钥签名清单与产物，客户端只认这把公钥。
//
//go:embed updater.pub
var updaterPublicKey []byte

// updateManifestURL 更新检查地址（本应用 fullname = DBEditor）。
// endpoint provider 会自动附加 platform / arch / version 查询参数，
// 这里额外带上 fullname 以便同一台更新服务区分不同应用。
const updateManifestURL = "https://www.earwind.top/api/v1/update/check?fullname=DBEditor"

// UpdateCheckEvent 触发前端“检查更新”流程的事件（payload: bool = 是否静默）
const UpdateCheckEvent = "app:update:check"

func init() {
	application.RegisterEvent[bool](UpdateCheckEvent)
}

// setupUpdater 初始化内置更新器，并挂上启动静默检查。
//
// 检查与下载分离：检测到新版本先交给前端确认，确认后才下载安装。
func setupUpdater(app *application.App) {
	ep, err := endpoint.New(endpoint.Config{
		URL: updateManifestURL,
		// 内置默认客户端 30s 超时会中断大文件下载，放宽到 10 分钟
		HTTPClient: &http.Client{Timeout: 10 * time.Minute},
	})
	if err != nil {
		log.Printf("更新器：创建更新源失败: %v", err)
		return
	}

	if err := app.Updater.Init(updater.Config{
		CurrentVersion: currentVersion,
		Providers:      []updater.Provider{ep},
		PublicKey:      updaterPublicKey,
	}); err != nil {
		log.Printf("更新器：初始化失败: %v", err)
		return
	}

	// 启动后静默检查：仅在确有新版本、且用户开启自动更新时才通知前端
	go func() {
		time.Sleep(4 * time.Second)
		if !loadSettings().AutoUpdate {
			return
		}
		if currentVersion == "" || currentVersion == "dev" {
			return
		}
		rel, err := app.Updater.Check(context.Background())
		if err != nil || rel == nil {
			return
		}
		app.Event.Emit(UpdateCheckEvent, true)
	}()
}
