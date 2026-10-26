package main

import (
	"context"
	"fmt"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// UpdateInfo 检查更新结果（供前端弹确认框展示）
type UpdateInfo struct {
	Available bool   `json:"available"`
	Version   string `json:"version"`
	Notes     string `json:"notes"`
	Size      int64  `json:"size"`
}

// UpdateService 应用设置与更新（绑定给前端）
type UpdateService struct{}

// CurrentVersion 当前应用版本号（构建时注入，未注入为 dev）
func (s *UpdateService) CurrentVersion() string {
	return currentVersion
}

// AutoUpdateEnabled 是否启用“启动时自动检查更新”
func (s *UpdateService) AutoUpdateEnabled() bool {
	return loadSettings().AutoUpdate
}

// SetAutoUpdateEnabled 设置自动更新开关
func (s *UpdateService) SetAutoUpdateEnabled(enabled bool) error {
	st := loadSettings()
	st.AutoUpdate = enabled
	return saveSettings(st)
}

// CheckUpdate 仅检查是否有新版本，不下载（供前端先确认）
func (s *UpdateService) CheckUpdate() (*UpdateInfo, error) {
	app := application.Get()
	if app == nil || app.Updater == nil {
		return nil, fmt.Errorf("更新器未初始化")
	}
	rel, err := app.Updater.Check(context.Background())
	if err != nil {
		return nil, err
	}
	if rel == nil {
		return &UpdateInfo{Available: false}, nil
	}
	return &UpdateInfo{
		Available: true,
		Version:   rel.Version,
		Notes:     rel.Notes,
		Size:      rel.Artifact.Size,
	}, nil
}

// StartInstall 用户确认后开始下载并安装（打开内置更新窗口展示进度与重启）
func (s *UpdateService) StartInstall() error {
	app := application.Get()
	if app == nil || app.Updater == nil {
		return fmt.Errorf("更新器未初始化")
	}
	go func() {
		if err := app.Updater.CheckAndInstall(context.Background()); err != nil {
			log.Printf("更新失败: %v", err)
		}
	}()
	return nil
}
