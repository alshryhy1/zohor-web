package com.zohor.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ZohorApp() }
    }
}

private enum class ZohorTab(val title: String) {
    Moments("اللحظات"),
    Map("الخريطة"),
    Chat("التواصل"),
    Live("مباشر"),
    Profile("حسابي"),
}

@Composable
private fun ZohorApp() {
    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            var selectedTab by rememberSaveable { mutableStateOf(ZohorTab.Moments) }
            Scaffold(
                bottomBar = {
                    NavigationBar {
                        ZohorTab.entries.forEach { tab ->
                            NavigationBarItem(
                                selected = selectedTab == tab,
                                onClick = { selectedTab = tab },
                                label = { Text(tab.title) },
                                icon = { Text(tab.title.first().toString()) },
                            )
                        }
                    }
                },
            ) { padding ->
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .padding(20.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    when (selectedTab) {
                        ZohorTab.Moments -> PlaceholderScreen("اللحظات", "عرض ورفع الصور والفيديو عبر BFF.")
                        ZohorTab.Map -> PlaceholderScreen("الخريطة", "منشورات صالحة فقط مع الموقع والصور/الفيديو.")
                        ZohorTab.Chat -> PlaceholderScreen("التواصل", "محادثات خاصة وقروبات عبر BFF وRealtime.")
                        ZohorTab.Live -> LiveDiscoveryPlaceholder()
                        ZohorTab.Profile -> PlaceholderScreen("حسابي", "الملف الشخصي ورقم الجوال وإعدادات الحساب.")
                    }
                }
            }
        }
    }
}

@Composable
private fun PlaceholderScreen(title: String, description: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(description, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun LiveDiscoveryPlaceholder() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("لا توجد بثوث مباشرة الآن", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = {}) { Text("بدء بث") }
        }
    }
}
