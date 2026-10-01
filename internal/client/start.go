package client

import (
	"os"
	"os/exec"
	"path/filepath"
)

func startDaemonProcess(home string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(home, 0o700); err != nil {
		return err
	}
	logf, err := os.OpenFile(filepath.Join(home, "daemon.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer logf.Close()
	cmd := exec.Command(exe, "daemon", "run")
	cmd.Env = append(os.Environ(), "TANDEM_HOME="+home)
	cmd.Stdout, cmd.Stderr = logf, logf
	cmd.SysProcAttr = sysProcAttr() // survive the agent's shell
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
