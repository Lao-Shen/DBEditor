package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := application.New(application.Options{
		Name:        "DBEditor",
		Description: "SQLite database viewer and editor",
		Services: []application.Service{
			application.NewService(&DBService{}),
			application.NewService(&UpdateService{}), // 应用设置与更新
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// 更新器：内置 updater + 自建更新清单（启动静默检查）
	setupUpdater(app)

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "DBEditor",
		Width:            1280,
		Height:           800,
		MinWidth:         900,
		MinHeight:        560,
		BackgroundColour: application.NewRGB(20, 20, 24),
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		URL: "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
