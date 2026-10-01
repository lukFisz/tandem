//go:build unix

package client

import "syscall"

// sysProcAttr detaches the daemon process so it survives the launching shell exiting.
func sysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setsid: true}
}
